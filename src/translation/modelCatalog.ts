import type { DeviceTranslationModel } from './types';

export type ModelDelivery = 'download' | 'bundled';

export interface DeviceModelPack {
  id: DeviceTranslationModel;
  displayName: string;
  description: string;
  expectedBytes: number;
  archiveFileName: string;
  activeModelFileName: string;
  filePrefix: string;
  downloadUrl: string;
  sha256?: string;
  delivery: ModelDelivery;
  recommended: boolean;
  experimental?: boolean;
}

const mb = (value: number) => value * 1024 * 1024;

/**
 * Product catalog only. URLs and SHA-256 values come from the model build
 * pipeline; benchmark numbers are not treated as deployable artifacts.
 *
 * Product policy:
 * - App does not bundle heavy models.
 * - Fast INT8 serves as standard offline package.
 * - Fast mixed (INT4/INT8) serves as enhanced quality package.
 * - NanoSakura is experimental and excluded from the active download list.
 */
export const DEVICE_MODEL_CATALOG: readonly DeviceModelPack[] = [
  {
    id: 'device.fast-v1-int8',
    displayName: 'Fast v1 标准离线翻译包',
    description: '标准全量化 INT8 模型，推断延迟极低（~64ms），抗 OCR 噪声鲁棒性最优。',
    expectedBytes: 502957448,
    archiveFileName: 'manifest.json',
    activeModelFileName: 'encoder_int8.onnx',
    filePrefix: 'fast-int8',
    downloadUrl: process.env.EXPO_PUBLIC_JMANGA_FAST_INT8_URL || 'https://models.atujii.top/jmt-fast/v1/fast-int8/2026-11-04/manifest.json',
    sha256: process.env.EXPO_PUBLIC_JMANGA_FAST_INT8_SHA256 || '826b31061d1931dd8f8cf3bfec497bace43c924b0a6bbebe3cd803186f7a8f4b',
    delivery: 'download',
    recommended: false,
    experimental: false,
  },
  {
    id: 'device.fast-v1-mixed',
    displayName: 'Fast v1 高清增强翻译包',
    description: 'Encoder 4-bit + Decoder 8-bit 混合量化，品质媲美浮点（BLEU 22.54），Wi-Fi 下推荐下载。',
    expectedBytes: 635846427,
    archiveFileName: 'manifest.json',
    activeModelFileName: 'encoder_int4.onnx',
    filePrefix: 'fast-mixed-int4-int8',
    downloadUrl: process.env.EXPO_PUBLIC_JMANGA_FAST_MIXED_URL || 'https://models.atujii.top/jmt-fast/v1/fast-mixed-int4-int8/2026-11-04/manifest.json',
    sha256: process.env.EXPO_PUBLIC_JMANGA_FAST_MIXED_SHA256 || '07b38a26da49ae7bece3fdb3c2229d6eafa5a6b9021a9641fe9f1729e1f1fc90',
    delivery: 'download',
    recommended: true,
    experimental: false,
  },
  {
    id: 'device.nanosakura-2.2-int8',
    displayName: 'NanoSakura 2.2 离线基础包 (实验性)',
    description: 'Transformer-Mamba2 SSM 极小模型，目前量化状态存在循环漂移风险，暂不推荐生产使用。',
    expectedBytes: mb(188),
    archiveFileName: 'nanosakura-2.2-int8.zip',
    activeModelFileName: 'encoder.onnx',
    filePrefix: 'nanosakura-2.2-int8',
    downloadUrl: process.env.EXPO_PUBLIC_NANOSAKURA_INT8_URL ?? '',
    sha256: process.env.EXPO_PUBLIC_NANOSAKURA_INT8_SHA256 || undefined,
    delivery: 'download',
    recommended: false,
    experimental: true,
  },
] as const;



export function getDeviceModelPack(id: DeviceTranslationModel): DeviceModelPack {
  const pack = DEVICE_MODEL_CATALOG.find((candidate) => candidate.id === id);
  if (!pack) throw new Error(`Unknown device model pack: ${id}`);
  return pack;
}


