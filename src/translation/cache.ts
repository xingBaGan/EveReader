import type { TranslationCache, TranslationItemResult } from './types';

export class MemoryTranslationCache implements TranslationCache {
  private readonly entries = new Map<string, TranslationItemResult>();

  async get(key: string): Promise<TranslationItemResult | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: TranslationItemResult): Promise<void> {
    this.entries.set(key, value);
  }

  clear(): void {
    this.entries.clear();
  }
}

export function createTranslationCacheKey(parts: {
  bookId: string;
  page: number;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  modelId: string;
  promptVersion?: string;
  glossaryVersion?: string;
}): string {
  return [
    'translation-v1',
    parts.bookId,
    parts.page,
    parts.sourceLanguage,
    parts.targetLanguage,
    parts.modelId,
    parts.promptVersion ?? '',
    parts.glossaryVersion ?? '',
    hashString(parts.sourceText),
  ].join(':');
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

