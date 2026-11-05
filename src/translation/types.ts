import type { ComicTextType, TextBubble } from '@/types/manga';

export type TranslationRoute = 'device' | 'llm' | 'hybrid';

export type DeviceTranslationModel =
  | 'device.fast-v1-mixed'
  | 'device.nanosakura-2.2-int8'
  | 'device.fast-v1-int8';

export type TranslationModelId = DeviceTranslationModel | `llm.${string}`;

export interface TranslationBubbleInput {
  id: string;
  sourceText: string;
  readingOrderIndex: number;
  textType: ComicTextType;
  direction: TextBubble['direction'];
  ocrConfidence?: number;
}

export interface TranslationContext {
  previousBubbles?: string[];
  glossary?: Record<string, string>;
  characterNames?: string[];
}

export interface TranslationRequest {
  requestId: string;
  bookId: string;
  page: number;
  sourceLanguage: string;
  targetLanguage: string;
  route: TranslationRoute;
  deviceModel?: DeviceTranslationModel;
  llmModel?: `llm.${string}`;
  fallbackToLlm?: boolean;
  bubbles: TranslationBubbleInput[];
  context?: TranslationContext;
  promptVersion?: string;
  glossaryVersion?: string;
}

export interface TranslationItemResult {
  id: string;
  sourceText: string;
  translatedText: string;
  providerId: string;
  modelId: TranslationModelId;
  confidence?: number;
  notes?: string;
  cached?: boolean;
}

export interface TranslationBatchResult {
  requestId: string;
  bookId: string;
  page: number;
  route: TranslationRoute;
  items: TranslationItemResult[];
  startedAt: number;
  completedAt: number;
}

export interface TranslationProgress {
  requestId: string;
  phase: 'cache' | 'device' | 'llm' | 'complete';
  completed: number;
  total: number;
  items: TranslationItemResult[];
}

export interface TranslationProviderRequest {
  requestId: string;
  bookId: string;
  page: number;
  sourceLanguage: string;
  targetLanguage: string;
  modelId: TranslationModelId;
  bubbles: TranslationBubbleInput[];
  context?: TranslationContext;
  promptVersion?: string;
  signal: AbortSignal;
}

export interface TranslationProvider {
  readonly id: string;
  supports(modelId: TranslationModelId): boolean;
  translate(request: TranslationProviderRequest): Promise<TranslationItemResult[]>;
}

export interface TranslationCache {
  get(key: string): Promise<TranslationItemResult | null>;
  set(key: string, value: TranslationItemResult): Promise<void>;
}

export interface TranslationRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: TranslationProgress) => void;
  shouldRefine?: (
    bubble: TranslationBubbleInput,
    deviceResult: TranslationItemResult
  ) => boolean;
}

export type TranslationErrorCode =
  | 'INVALID_REQUEST'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_RESULT_INVALID'
  | 'ABORTED';

export class TranslationError extends Error {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

