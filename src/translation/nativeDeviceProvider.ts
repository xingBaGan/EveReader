import { onnxTranslateBatch } from 'screen-translator-overlay';

import { DeviceModelManager } from './deviceModelManager';
import type {
  DeviceTranslationModel,
  TranslationItemResult,
  TranslationModelId,
  TranslationProvider,
  TranslationProviderRequest,
} from './types';

const DEVICE_MODELS = new Set<DeviceTranslationModel>([
  'device.fast-v1-mixed',
  'device.nanosakura-2.2-int8',
  'device.fast-v1-int8',
]);

export class NativeDeviceTranslationProvider implements TranslationProvider {
  readonly id = 'android-onnx';

  constructor(private readonly models = new DeviceModelManager()) {}

  supports(modelId: TranslationModelId): boolean {
    return DEVICE_MODELS.has(modelId as DeviceTranslationModel);
  }

  async translate(request: TranslationProviderRequest): Promise<TranslationItemResult[]> {
    if (request.signal.aborted) throw request.signal.reason;
    const modelId = request.modelId as DeviceTranslationModel;
    const activated = await this.models.activate(modelId);
    if (!activated) throw new Error(`无法激活端侧模型 ${modelId}`);

    const inputs = Object.fromEntries(
      request.bubbles.map((bubble) => [bubble.id, bubble.sourceText])
    );
    const outputs = await onnxTranslateBatch(inputs);
    if (request.signal.aborted) throw request.signal.reason;

    return request.bubbles.map((bubble) => ({
      id: bubble.id,
      sourceText: bubble.sourceText,
      translatedText: outputs[bubble.id] ?? '',
      providerId: this.id,
      modelId,
    }));
  }
}

