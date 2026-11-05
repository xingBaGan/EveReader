import type {
  TranslationItemResult,
  TranslationModelId,
  TranslationProvider,
  TranslationProviderRequest,
} from './types';

export type TranslationExecutor = (
  request: TranslationProviderRequest
) => Promise<TranslationItemResult[]>;

/**
 * Bridges a future native module or online API client into the orchestrator.
 * Model loading, batching and platform-specific details stay outside the core.
 */
export class ExecutorTranslationProvider implements TranslationProvider {
  constructor(
    public readonly id: string,
    private readonly supportedModels: readonly TranslationModelId[],
    private readonly executor: TranslationExecutor
  ) {}

  supports(modelId: TranslationModelId): boolean {
    return this.supportedModels.includes(modelId);
  }

  translate(request: TranslationProviderRequest): Promise<TranslationItemResult[]> {
    return this.executor(request);
  }
}

