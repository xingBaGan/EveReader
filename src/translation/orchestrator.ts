import { createTranslationCacheKey, MemoryTranslationCache } from './cache';
import { TranslationProviderRegistry } from './providerRegistry';
import {
  TranslationError,
  type DeviceTranslationModel,
  type TranslationBatchResult,
  type TranslationBubbleInput,
  type TranslationCache,
  type TranslationItemResult,
  type TranslationModelId,
  type TranslationProgress,
  type TranslationProviderRequest,
  type TranslationRequest,
  type TranslationRoute,
  type TranslationRunOptions,
} from './types';

const DEFAULT_DEVICE_MODEL: DeviceTranslationModel = 'device.fast-v1-int8';
export const DEFAULT_TRANSLATION_ROUTE: TranslationRoute = 'llm';

export class TranslationOrchestrator {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly inFlight = new Map<string, Promise<TranslationBatchResult>>();

  constructor(
    private readonly registry: TranslationProviderRegistry,
    private readonly cache: TranslationCache = new MemoryTranslationCache()
  ) {}

  run(
    request: TranslationRequest,
    options: TranslationRunOptions = {}
  ): Promise<TranslationBatchResult> {
    this.validate(request);
    const existing = this.inFlight.get(request.requestId);
    if (existing) return existing;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    this.activeRuns.set(request.requestId, controller);
    const promise = this.execute(request, controller.signal, options).finally(() => {
      options.signal?.removeEventListener('abort', abortFromCaller);
      this.activeRuns.delete(request.requestId);
      this.inFlight.delete(request.requestId);
    });
    this.inFlight.set(request.requestId, promise);
    return promise;
  }

  cancel(requestId: string): boolean {
    const controller = this.activeRuns.get(requestId);
    if (!controller) return false;
    controller.abort(`Translation request ${requestId} was cancelled`);
    return true;
  }

  cancelAll(): void {
    for (const controller of this.activeRuns.values()) controller.abort();
  }

  private async execute(
    request: TranslationRequest,
    signal: AbortSignal,
    options: TranslationRunOptions
  ): Promise<TranslationBatchResult> {
    const startedAt = Date.now();
    const deviceModel = request.deviceModel ?? DEFAULT_DEVICE_MODEL;
    const primaryModel = request.route === 'llm' ? request.llmModel! : deviceModel;

    let items: TranslationItemResult[];
    try {
      items = await this.translateWithCache(
        request,
        request.bubbles,
        primaryModel,
        signal,
        (progressItems) =>
          this.emitProgress(
            options,
            request,
            request.route === 'llm' ? 'llm' : 'device',
            progressItems
          )
      );
    } catch (error) {
      this.throwIfAborted(signal);
      if (!request.fallbackToLlm || !request.llmModel || request.route === 'llm') throw error;
      items = await this.translateWithCache(
        request,
        request.bubbles,
        request.llmModel,
        signal,
        (progressItems) => this.emitProgress(options, request, 'llm', progressItems)
      );
      this.emitProgress(options, request, 'complete', items);
      return {
        requestId: request.requestId,
        bookId: request.bookId,
        page: request.page,
        route: request.route,
        items,
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (request.route === 'hybrid' && request.llmModel) {
      const byId = new Map(items.map((item) => [item.id, item]));
      const refinementInputs = request.bubbles.filter((bubble) => {
        const result = byId.get(bubble.id);
        return result ? (options.shouldRefine ?? defaultShouldRefine)(bubble, result) : true;
      });

      if (refinementInputs.length > 0) {
        const refined = await this.translateWithCache(
          request,
          refinementInputs,
          request.llmModel,
          signal,
          (progressItems) => this.emitProgress(options, request, 'llm', progressItems)
        );
        for (const item of refined) byId.set(item.id, item);
        items = request.bubbles.flatMap((bubble) => {
          const item = byId.get(bubble.id);
          return item ? [item] : [];
        });
      }
    }

    this.throwIfAborted(signal);
    this.emitProgress(options, request, 'complete', items);
    return {
      requestId: request.requestId,
      bookId: request.bookId,
      page: request.page,
      route: request.route,
      items,
      startedAt,
      completedAt: Date.now(),
    };
  }

  private async translateWithCache(
    request: TranslationRequest,
    bubbles: TranslationBubbleInput[],
    modelId: TranslationModelId,
    signal: AbortSignal,
    onProviderResult: (items: TranslationItemResult[]) => void
  ): Promise<TranslationItemResult[]> {
    this.throwIfAborted(signal);
    const found = new Map<string, TranslationItemResult>();
    const missing: TranslationBubbleInput[] = [];

    await Promise.all(
      bubbles.map(async (bubble) => {
        const cached = await this.cache.get(this.cacheKey(request, bubble, modelId));
        if (cached) found.set(bubble.id, { ...cached, cached: true });
        else missing.push(bubble);
      })
    );

    if (missing.length > 0) {
      const provider = this.registry.resolve(modelId);
      const providerRequest: TranslationProviderRequest = {
        requestId: request.requestId,
        bookId: request.bookId,
        page: request.page,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        modelId,
        bubbles: missing,
        context: request.context,
        promptVersion: request.promptVersion,
        signal,
      };
      const translated = await provider.translate(providerRequest);
      this.validateProviderResults(missing, translated);
      await Promise.all(
        translated.map(async (item) => {
          found.set(item.id, item);
          const input = missing.find((bubble) => bubble.id === item.id)!;
          await this.cache.set(this.cacheKey(request, input, modelId), item);
        })
      );
      onProviderResult(translated);
    }

    this.throwIfAborted(signal);
    return bubbles.flatMap((bubble) => {
      const item = found.get(bubble.id);
      return item ? [item] : [];
    });
  }

  private cacheKey(
    request: TranslationRequest,
    bubble: TranslationBubbleInput,
    modelId: TranslationModelId
  ): string {
    return createTranslationCacheKey({
      bookId: request.bookId,
      page: request.page,
      sourceText: bubble.sourceText,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      modelId,
      promptVersion: request.promptVersion,
      glossaryVersion: request.glossaryVersion,
    });
  }

  private validate(request: TranslationRequest): void {
    if (!request.requestId || !request.bookId || request.page < 1) {
      throw new TranslationError('INVALID_REQUEST', 'requestId, bookId and a positive page are required');
    }
    if (request.route !== 'device' && !request.llmModel) {
      throw new TranslationError('INVALID_REQUEST', `${request.route} route requires llmModel`);
    }
    if (request.fallbackToLlm && !request.llmModel) {
      throw new TranslationError('INVALID_REQUEST', 'fallbackToLlm requires llmModel');
    }
    const ids = new Set<string>();
    for (const bubble of request.bubbles) {
      if (!bubble.id || !bubble.sourceText.trim() || ids.has(bubble.id)) {
        throw new TranslationError(
          'INVALID_REQUEST',
          'Every bubble needs a unique id and non-empty sourceText'
        );
      }
      ids.add(bubble.id);
    }
  }

  private validateProviderResults(
    requested: TranslationBubbleInput[],
    results: TranslationItemResult[]
  ): void {
    const requestedIds = new Set(requested.map((bubble) => bubble.id));
    const resultIds = new Set(results.map((item) => item.id));
    const invalid =
      results.some(
        (item) => !requestedIds.has(item.id) || !item.translatedText.trim() || !item.modelId
      ) || requested.some((bubble) => !resultIds.has(bubble.id));
    if (invalid) {
      throw new TranslationError(
        'PROVIDER_RESULT_INVALID',
        'Translation provider returned missing, unknown, or empty bubble results'
      );
    }
  }

  private emitProgress(
    options: TranslationRunOptions,
    request: TranslationRequest,
    phase: TranslationProgress['phase'],
    items: TranslationItemResult[]
  ): void {
    options.onProgress?.({
      requestId: request.requestId,
      phase,
      completed: items.length,
      total: request.bubbles.length,
      items,
    });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new TranslationError('ABORTED', 'Translation was aborted', signal.reason);
    }
  }
}

export function defaultShouldRefine(
  bubble: TranslationBubbleInput,
  result: TranslationItemResult
): boolean {
  return (
    bubble.textType === 'sfx' ||
    (bubble.ocrConfidence !== undefined && bubble.ocrConfidence < 0.82) ||
    (result.confidence !== undefined && result.confidence < 0.75) ||
    !result.translatedText.trim()
  );
}

