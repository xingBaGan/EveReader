import { Platform } from 'react-native';

/**
 * 跨端原生漫画翻译/气泡检测安全桥接器
 * 1. 在 Expo Go、Web 或 iOS 预览环境下优雅回退，绝不导致 Metro 捆绑失败或红屏崩溃
 * 2. 在 Android 独立编译 APK (Development Build) 下自动接入底层原生 ONNX & ML Kit
 */

let NativeModule: any = null;

try {
  if (Platform.OS === 'android') {
    // 动态安全加载 expo-modules-core 原生模块，避免硬编码 package.json 依赖
    const { requireNativeModule } = require('expo-modules-core');
    NativeModule = requireNativeModule('ScreenTranslatorOverlay');
  }
} catch {
  // Expo Go、Web 或未编译原生环境
  NativeModule = null;
}

/**
 * 判断当前运行环境底层是否支持原生 ONNX / ML Kit 识别模块
 */
export function isScreenTranslatorSupported(): boolean {
  return NativeModule != null;
}

/**
 * 安全调用端侧原生漫画文字与气泡识别
 */
export async function recognizeImageNative(
  imageUri: string,
  lang: string = 'ja'
): Promise<any> {
  if (!NativeModule || typeof NativeModule.recognizeImage !== 'function') {
    return null;
  }

  try {
    return await NativeModule.recognizeImage(imageUri, lang);
  } catch (err) {
    console.warn('[ScreenTranslatorBridge] 原生调用执行异常:', err);
    return null;
  }
}
