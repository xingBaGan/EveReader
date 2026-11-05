import { MemoryTranslationCache } from './cache';
import { NativeDeviceTranslationProvider } from './nativeDeviceProvider';
import { TranslationOrchestrator } from './orchestrator';
import { TranslationProviderRegistry } from './providerRegistry';
import type { TranslationCache, TranslationProvider } from './types';

export interface TranslationRuntimeOptions {
  cache?: TranslationCache;
  llmProvider?: TranslationProvider;
}

/**
 * Creates the app runtime with the Android ONNX provider registered.
 * The online LLM adapter is injected by the API configuration layer so API
 * credentials and provider-specific payloads never leak into the core.
 */
export function createTranslationRuntime(
  options: TranslationRuntimeOptions = {}
): TranslationOrchestrator {
  const registry = new TranslationProviderRegistry();
  registry.register(new NativeDeviceTranslationProvider());
  if (options.llmProvider) registry.register(options.llmProvider);
  return new TranslationOrchestrator(
    registry,
    options.cache ?? new MemoryTranslationCache()
  );
}

