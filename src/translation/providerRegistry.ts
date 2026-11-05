import {
  TranslationError,
  type TranslationModelId,
  type TranslationProvider,
} from './types';

export class TranslationProviderRegistry {
  private readonly providers = new Map<string, TranslationProvider>();

  register(provider: TranslationProvider): () => void {
    this.providers.set(provider.id, provider);
    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id);
      }
    };
  }

  resolve(modelId: TranslationModelId): TranslationProvider {
    const provider = [...this.providers.values()].find((candidate) =>
      candidate.supports(modelId)
    );
    if (!provider) {
      throw new TranslationError(
        'PROVIDER_NOT_FOUND',
        `No translation provider is registered for ${modelId}`
      );
    }
    return provider;
  }
}

