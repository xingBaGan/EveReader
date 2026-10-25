import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import {
  CapturedScreenEvent,
  ServiceStateEvent,
  OverlayBubbleItem,
  RecognizeImageResult,
  Subscription,
} from './ScreenTranslatorOverlay.types';

export * from './ScreenTranslatorOverlay.types';

let NativeModule: any = null;
try {
  if (Platform.OS === 'android') {
    NativeModule = requireNativeModule('ScreenTranslatorOverlay');
  }
} catch {
  // 运行在 Expo Go、Web 或 iOS 模拟环境，NativeModule 尚未编译接入
  NativeModule = null;
}

// 模拟事件发射器（用于 Web/iOS 或 Expo Go 预览环境）
const mockCaptureListeners = new Set<(event: CapturedScreenEvent) => void>();
const mockStateListeners = new Set<(event: ServiceStateEvent) => void>();
let mockServiceRunning = false;

/**
 * 判断当前设备系统是否原生支持跨应用悬浮窗与屏幕捕获（仅 Android 支持）
 */
export function isSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  return NativeModule != null;
}

/**
 * 检查是否已授予 Android【在其他应用上层显示】悬浮窗权限 (SYSTEM_ALERT_WINDOW)
 */
export function isOverlayPermissionGranted(): boolean {
  if (!NativeModule) return false;
  try {
    return Boolean(NativeModule.isOverlayPermissionGranted());
  } catch {
    return false;
  }
}

/**
 * 请求授予悬浮窗权限（会自动跳转到 Android 系统【显示在其他应用上层】设置页面）
 */
export function requestOverlayPermission(): boolean {
  if (!NativeModule) return false;
  try {
    return Boolean(NativeModule.requestOverlayPermission());
  } catch {
    return false;
  }
}

/**
 * 检查跨应用悬浮服务与 MediaProjection 屏幕捕获是否正在运行
 */
export function isServiceRunning(): boolean {
  if (!NativeModule) return false;
  try {
    return Boolean(NativeModule.isServiceRunning());
  } catch {
    return false;
  }
}

/**
 * 启动跨应用悬浮翻译服务
 * 1. 自动校验系统悬浮窗权限（未授予则提示去设置）
 * 2. 调起 Android 系统 MediaProjection 屏幕截屏/录制安全确认弹窗
 * 3. 授权通过后在屏幕侧边挂载高灵敏度悬浮球
 */
export async function startOverlayService(): Promise<boolean> {
  if (!NativeModule) {
    throw new Error(
      'NATIVE_MODULE_NOT_FOUND: 当前处于 Expo Go 或未编译原生环境。跨应用系统级悬浮球依赖底层 WindowManager 与 MediaProjection 原生模块，请在终端执行 `npx expo run:android` 编译安装开发版 APK 即可正常生效！'
    );
  }

  return await NativeModule.startOverlayService();
}

/**
 * 停止悬浮服务，清理 WindowManager 悬浮球与后台 MediaProjection
 */
export function stopOverlayService(): boolean {
  if (!NativeModule) return false;

  try {
    return Boolean(NativeModule.stopOverlayService());
  } catch {
    return false;
  }
}

/**
 * 彻底退出整个应用并清理所有关联进程与常驻服务
 */
export function exitApp(): boolean {
  if (!NativeModule) return false;

  try {
    return Boolean(NativeModule.exitApp());
  } catch {
    return false;
  }
}

/**
 * 手动/程序触发一次屏幕截屏
 */
export function captureScreen(): boolean {
  if (!NativeModule) {
    // 模拟捕获事件
    setTimeout(() => {
      const mockEvent: CapturedScreenEvent = {
        uri: 'mock_captured_screen',
        width: 1080,
        height: 2400,
        timestamp: Date.now(),
      };
      mockCaptureListeners.forEach((l) => l(mockEvent));
    }, 300);
    return true;
  }

  try {
    return Boolean(NativeModule.captureScreen());
  } catch {
    return false;
  }
}

/**
 * 将 OCR 与模型翻译得到的气泡结果同步到第三方应用上方的悬浮卡片/原地覆盖层
 */
export function updateTranslationResult(bubbles: OverlayBubbleItem[]): boolean {
  const jsonStr = JSON.stringify(bubbles);
  if (!NativeModule) {
    return true;
  }

  try {
    return Boolean(NativeModule.updateTranslationResult(jsonStr));
  } catch {
    return false;
  }
}

/**
 * 开启或关闭路线 B 实时滚动识别与追踪模式
 */
export function setRealtimeMode(enabled: boolean): boolean {
  if (!NativeModule || typeof NativeModule.setRealtimeMode !== 'function') return false;
  try {
    return Boolean(NativeModule.setRealtimeMode(enabled));
  } catch {
    return false;
  }
}

/**
 * 查询是否开启了实时识别模式
 */
export function isRealtimeMode(): boolean {
  if (!NativeModule || typeof NativeModule.isRealtimeMode !== 'function') return false;
  try {
    return Boolean(NativeModule.isRealtimeMode());
  } catch {
    return false;
  }
}

/**
 * 控制在第三方应用上是否显示原位文字坐标高亮框与语种标签
 */
export function setHudVisible(visible: boolean): boolean {
  if (!NativeModule || typeof NativeModule.setHudVisible !== 'function') return false;
  try {
    return Boolean(NativeModule.setHudVisible(visible));
  } catch {
    return false;
  }
}

/**
 * 切换第三方应用上的原位显示内容: 'box'(仅矩形检测框) | 'ocr'(OCR识别原文) | 'target'(译文) | 'both'(双语对照)
 */
export function setHudDisplayMode(mode: 'box' | 'ocr' | 'target' | 'both'): boolean {
  setStringSetting('hud_display_mode', mode);
  if (!NativeModule || typeof NativeModule.setHudDisplayMode !== 'function') return false;
  try {
    return Boolean(NativeModule.setHudDisplayMode(mode));
  } catch {
    return false;
  }
}

/**
 * 获取当前设置的原位显示内容模式: 'box' | 'ocr' | 'target' | 'both'
 */
export function getHudDisplayMode(): 'box' | 'ocr' | 'target' | 'both' {
  if (NativeModule && typeof NativeModule.getHudDisplayMode === 'function') {
    try {
      const res = NativeModule.getHudDisplayMode();
      if (res) return String(res) as any;
    } catch {
      // ignore
    }
  }
  return (getStringSetting('hud_display_mode', 'ocr') as any) || 'ocr';
}

/**
 * 设置指定识别的源语言过滤（只识别被翻译的指定语言，如 'ja' 仅识别日语，'en' 仅识别英语，'zh' 仅识别中文，'ko' 仅识别韩语，'all' 识别全部）
 */
export function setSourceLanguageFilter(lang: 'ja' | 'en' | 'zh' | 'ko' | 'all' | string): boolean {
  setStringSetting('source_language_filter', lang);
  if (!NativeModule || typeof NativeModule.setSourceLanguageFilter !== 'function') return true;
  try {
    return Boolean(NativeModule.setSourceLanguageFilter(lang));
  } catch {
    return false;
  }
}

/**
 * 获取当前设置的指定识别源语言过滤
 */
export function getSourceLanguageFilter(): string {
  if (NativeModule && typeof NativeModule.getSourceLanguageFilter === 'function') {
    try {
      const res = NativeModule.getSourceLanguageFilter();
      if (res) return String(res);
    } catch {
      // ignore
    }
  }
  return getStringSetting('source_language_filter', 'ja');
}

/**
 * 彻底销毁清空屏幕上的全部悬浮文本框
 */
export function clearHudText(): boolean {
  if (!NativeModule || typeof NativeModule.clearHudText !== 'function') return false;
  try {
    return Boolean(NativeModule.clearHudText());
  } catch {
    return false;
  }
}

/**
 * 设置指定监听的目标应用包名与名称（切换离开该应用时，屏幕上的文字将被自动销毁）
 */
export function setTargetApp(packageName: string | null, appName?: string | null): boolean {
  if (!NativeModule || typeof NativeModule.setTargetApp !== 'function') return false;
  try {
    return Boolean(NativeModule.setTargetApp(packageName, appName ?? null));
  } catch {
    return false;
  }
}

/**
 * 获取当前锁定的目标应用包名与名称
 */
export function getTargetApp(): { packageName: string | null; appName: string | null } {
  if (!NativeModule || typeof NativeModule.getTargetApp !== 'function') {
    return { packageName: null, appName: null };
  }
  try {
    const res = NativeModule.getTargetApp();
    return {
      packageName: res?.packageName ?? null,
      appName: res?.appName ?? null,
    };
  } catch {
    return { packageName: null, appName: null };
  }
}

/**
 * 一键锁定当前前台正在运行的应用
 */
export function lockCurrentApp(): { success: boolean; packageName?: string; appName?: string } {
  if (!NativeModule || typeof NativeModule.lockCurrentApp !== 'function') {
    return { success: false };
  }
  try {
    const res = NativeModule.lockCurrentApp();
    return res || { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * 解除目标应用锁定（恢复为全部应用均可识别）
 */
export function unlockTargetApp(): boolean {
  if (!NativeModule || typeof NativeModule.unlockTargetApp !== 'function') return false;
  try {
    return Boolean(NativeModule.unlockTargetApp());
  } catch {
    return false;
  }
}

/**
 * 设置切换离开目标应用时是否销毁屏幕气泡
 * true = 切换离开目标应用时立即彻底销毁屏幕文字 (默认保护模式)
 * false = 切换离开目标应用时保留气泡在屏幕上供查阅，但绝对不翻译其他应用 (对照查阅模式)
 */
export function setDestroyOnAppSwitch(destroy: boolean): boolean {
  setStringSetting('destroy_bubbles_on_app_switch', destroy ? 'true' : 'false');
  if (!NativeModule || typeof NativeModule.setDestroyOnAppSwitch !== 'function') return true;
  try {
    return Boolean(NativeModule.setDestroyOnAppSwitch(destroy));
  } catch {
    return false;
  }
}

/**
 * 获取当前是否在切换离开目标应用时销毁屏幕气泡
 */
export function isDestroyOnAppSwitch(): boolean {
  if (NativeModule && typeof NativeModule.isDestroyOnAppSwitch === 'function') {
    try {
      return Boolean(NativeModule.isDestroyOnAppSwitch());
    } catch {
      // ignore
    }
  }
  return getStringSetting('destroy_bubbles_on_app_switch', 'true') !== 'false';
}

export type OutsideAppBallBehavior = 'dormant' | 'hide' | 'touch_through';

/**
 * 设置切出目标应用时悬浮球的行为
 * 'dormant': 待机休眠半透明，不可点击，阻止任何屏幕事件与 loading (默认)
 * 'hide': 完全隐藏，切回目标应用时自动恢复显示
 * 'touch_through': 触摸穿透，悬浮球不可点击且不拦截底层触摸
 */
export function setOutsideAppBallBehavior(behavior: OutsideAppBallBehavior): boolean {
  setStringSetting('outside_app_ball_behavior', behavior);
  if (!NativeModule || typeof NativeModule.setOutsideAppBallBehavior !== 'function') return true;
  try {
    return Boolean(NativeModule.setOutsideAppBallBehavior(behavior));
  } catch {
    return false;
  }
}

/**
 * 获取切出目标应用时悬浮球的行为
 */
export function getOutsideAppBallBehavior(): OutsideAppBallBehavior {
  if (NativeModule && typeof NativeModule.getOutsideAppBallBehavior === 'function') {
    try {
      const res = NativeModule.getOutsideAppBallBehavior();
      if (res === 'hide' || res === 'touch_through' || res === 'dormant') {
        return res;
      }
    } catch {
      // ignore
    }
  }
  const saved = getStringSetting('outside_app_ball_behavior', 'dormant');
  if (saved === 'hide' || saved === 'touch_through' || saved === 'dormant') {
    return saved;
  }
  return 'dormant';
}

/**
 * 获取当前系统前台活跃的应用包名
 */
export function getForegroundPackageName(): string | null {
  if (!NativeModule || typeof NativeModule.getForegroundPackageName !== 'function') return null;
  try {
    const res = NativeModule.getForegroundPackageName();
    return res ? String(res) : null;
  } catch {
    return null;
  }
}

/**
 * 检查是否已授予“使用情况访问权限” (PACKAGE_USAGE_STATS)，用于精准感知前台应用切换
 */
export function hasUsageStatsPermission(): boolean {
  if (!NativeModule || typeof NativeModule.hasUsageStatsPermission !== 'function') return false;
  try {
    return Boolean(NativeModule.hasUsageStatsPermission());
  } catch {
    return false;
  }
}

/**
 * 请求授予“使用情况访问权限”（自动跳转到系统设置页面）
 */
export function requestUsageStatsPermission(): boolean {
  if (!NativeModule || typeof NativeModule.requestUsageStatsPermission !== 'function') return false;
  try {
    return Boolean(NativeModule.requestUsageStatsPermission());
  } catch {
    return false;
  }
}

/**
 * 获取设备上已安装的可启动第三方应用列表
 */
export function getInstalledApps(): Array<{ packageName: string; appName: string }> {
  if (!NativeModule || typeof NativeModule.getInstalledApps !== 'function') return [];
  try {
    return NativeModule.getInstalledApps() || [];
  } catch {
    return [];
  }
}

/**
 * 调用端侧 Google ML Kit 离线识别指定本地图片的文字与气泡位置 (包含对白气泡、画面标题、旁白、拟声词)
 */
export async function recognizeImage(
  imageUri: string,
  lang: string = 'ja'
): Promise<RecognizeImageResult> {
  if (!NativeModule || typeof NativeModule.recognizeImage !== 'function') {
    console.warn(
      '[ScreenOverlay] 原生 recognizeImage 方法未在当前运行的 APK 中找到。请运行 "npx expo run:android" 编译最新原生代码。'
    );
    return {
      width: 0,
      height: 0,
      bubbles: [],
      error: 'NATIVE_REBUILD_REQUIRED',
    };
  }

  try {
    const res = await NativeModule.recognizeImage(imageUri, lang);
    if (Array.isArray(res)) {
      return { width: 0, height: 0, bubbles: res };
    }
    return {
      width: res?.width || 0,
      height: res?.height || 0,
      bubbles: res?.bubbles || [],
    };
  } catch (err: any) {
    console.warn('[ScreenOverlay] recognizeImage 执行失败:', err);
    return {
      width: 0,
      height: 0,
      bubbles: [],
      error: err?.message || 'OCR_ERROR',
    };
  }
}

/**
 * 局部区域高精度 OCR 识别 (针对用户在画布点击未识别区域的人机协同点按交互)
 */
export async function recognizeRegion(
  imageUri: string,
  cx: number,
  cy: number,
  radiusW?: number,
  radiusH?: number,
  lang: string = 'ja'
): Promise<OverlayBubbleItem | null> {
  if (!NativeModule || typeof NativeModule.recognizeRegion !== 'function') {
    return null;
  }
  try {
    const res = await NativeModule.recognizeRegion(imageUri, cx, cy, radiusW, radiusH, lang);
    return res || null;
  } catch (err: any) {
    console.warn('[ScreenOverlay] recognizeRegion 执行异常:', err);
    return null;
  }
}

/**
 * 监听悬浮球点击或屏幕捕获完成事件
 * 当在第三方应用（如 Tachiyomi、B站漫画、Kindle等）上轻触悬浮球时，会触发该事件并回传截屏图片 Uri 与尺寸
 */
export function addScreenCaptureListener(
  listener: (event: CapturedScreenEvent) => void
): Subscription {
  if (!NativeModule) {
    mockCaptureListeners.add(listener);
    return {
      remove: () => {
        mockCaptureListeners.delete(listener);
      },
    };
  }

  return NativeModule.addListener('onScreenCaptured', listener);
}

/**
 * 监听前台悬浮服务的启动/关闭状态变更
 */
export function addServiceStateListener(
  listener: (event: ServiceStateEvent) => void
): Subscription {
  if (!NativeModule) {
    mockStateListeners.add(listener);
    return {
      remove: () => {
        mockStateListeners.delete(listener);
      },
    };
  }

  return NativeModule.addListener('onServiceStateChanged', listener);
}

/**
 * 监听原位文字销毁/清空事件（例如用户切换离开了目标应用）
 */
export function addHudClearedListener(listener: () => void): Subscription {
  if (!NativeModule) {
    return {
      remove: () => {},
    };
  }

  return NativeModule.addListener('onHudCleared', listener);
}

/**
 * 监听原位显示内容模式变更事件（例如在悬浮窗卡片中切换了矩形框/OCR/译文/双语）
 */
export function addHudDisplayModeListener(
  listener: (event: { mode: 'box' | 'ocr' | 'target' | 'both' }) => void
): Subscription {
  if (!NativeModule) {
    return {
      remove: () => {},
    };
  }

  return NativeModule.addListener('onHudDisplayModeChanged', listener);
}

const inMemoryStorage = new Map<string, string>();

/**
 * 读取本地持久化字符串配置（Android 端基于系统原生 SharedPreferences，Web 端基于 localStorage）
 */
export function getStringSetting(key: string, defaultValue: string = ''): string {
  if (NativeModule && typeof NativeModule.getStringSetting === 'function') {
    try {
      const val = NativeModule.getStringSetting(key, defaultValue);
      if (val !== undefined && val !== null) {
        return String(val);
      }
    } catch (err) {
      console.warn('[ScreenOverlay] 读取原生 SharedPreferences 失败:', err);
    }
  }

  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : defaultValue;
    } catch {
      // ignore
    }
  }

  return inMemoryStorage.has(key) ? inMemoryStorage.get(key)! : defaultValue;
}

/**
 * 写入本地持久化字符串配置（Android 端基于系统原生 SharedPreferences，Web 端基于 localStorage）
 */
export function setStringSetting(key: string, value: string): boolean {
  inMemoryStorage.set(key, value);

  if (NativeModule && typeof NativeModule.setStringSetting === 'function') {
    try {
      return Boolean(NativeModule.setStringSetting(key, value));
    } catch (err) {
      console.warn('[ScreenOverlay] 写入原生 SharedPreferences 失败:', err);
    }
  }

  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      // ignore
    }
  }

  return true;
}

/**
 * 设置 OCR 识别视口聚焦模式
 * 'golden': 👑 黄金阅读视口（推荐，过滤上下 12% 边缘，中央 76% 聚焦，2.0x 超分锐化防抖，专攻「凛子」等多笔画复杂汉字）
 * 'center50': 🔍 中央 50% 视口（极速识别模式，速度提升 50%）
 * 'full': 📱 全屏 100% 视口（完整扫描）
 */
export function setViewportMode(mode: 'golden' | 'center50' | 'full'): boolean {
  if (NativeModule && typeof NativeModule.setViewportMode === 'function') {
    try {
      return Boolean(NativeModule.setViewportMode(mode));
    } catch (err) {
      console.warn('[ScreenOverlay] setViewportMode 原生调用失败:', err);
    }
  }
  return setStringSetting('viewport_mode', mode);
}

/**
 * 获取当前的 OCR 识别视口聚焦模式
 */
export function getViewportMode(): 'golden' | 'center50' | 'full' {
  if (NativeModule && typeof NativeModule.getViewportMode === 'function') {
    try {
      const mode = NativeModule.getViewportMode();
      if (mode) return mode as any;
    } catch {}
  }
  return (getStringSetting('viewport_mode', 'golden') as any) || 'golden';
}

/**
 * 检查漫画专用端侧 OCR 识别模型 (Manga-OCR Mobile) 是否已初始化完成
 */
export function isMangaOcrReady(): boolean {
  if (!NativeModule || typeof NativeModule.isMangaOcrReady !== 'function') return false;
  try {
    return Boolean(NativeModule.isMangaOcrReady());
  } catch {
    return false;
  }
}

/**
 * 获取漫画专用端侧 OCR 识别模型的当前状态信息
 */
export function getMangaOcrStatus(): string {
  if (!NativeModule || typeof NativeModule.getMangaOcrStatus !== 'function') return '未加载';
  try {
    return String(NativeModule.getMangaOcrStatus());
  } catch {
    return '加载异常';
  }
}

/**
 * 调用漫画端侧专用模型 (Manga-OCR Mobile) 识别指定图片的局部矩形区域
 */
export async function recognizeMangaCrop(
  imageUri: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<string> {
  if (!NativeModule || typeof NativeModule.recognizeMangaCrop !== 'function') {
    return '';
  }
  try {
    const text = await NativeModule.recognizeMangaCrop(imageUri, x, y, width, height);
    return text || '';
  } catch (err: any) {
    console.warn('[ScreenOverlay] recognizeMangaCrop 失败:', err);
    return '';
  }
}

/**
 * 设置悬浮球的加载动画与状态
 * @param isLoading 是否显示加载动画 (true 时悬浮球持续旋转并展示梦幻紫蓝渐变与状态徽章)
 * @param statusText 悬浮球右上角徽章显示的文字（如 "翻译中"、"DeepSeek"、"识别中"）
 */
export function setBallLoading(isLoading: boolean, statusText: string = '翻译中'): boolean {
  if (!NativeModule || typeof NativeModule.setBallLoading !== 'function') return false;
  try {
    return Boolean(NativeModule.setBallLoading(isLoading, statusText));
  } catch {
    return false;
  }
}

/**
 * 设置悬浮球的文本状态与是否处于处理中
 */
export function setBallState(statusText: string, isProcessing: boolean): boolean {
  if (!NativeModule || typeof NativeModule.setBallState !== 'function') return false;
  try {
    return Boolean(NativeModule.setBallState(statusText, isProcessing));
  } catch {
    return false;
  }
}

/**
 * 检查当前原生运行环境是否支持 Google ML Kit 端侧离线翻译引擎
 */
export function isMlKitTranslateSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  if (!NativeModule || typeof NativeModule.isMlKitTranslateSupported !== 'function') return false;
  try {
    return Boolean(NativeModule.isMlKitTranslateSupported());
  } catch {
    return false;
  }
}

/**
 * 检查指定语言对的端侧离线翻译模型下载就绪状态
 */
export async function mlkitCheckModel(
  sourceLang: string = 'ja',
  targetLang: string = 'zh'
): Promise<{
  sourceDownloaded: boolean;
  targetDownloaded: boolean;
  ready: boolean;
  sourceLang: string;
  targetLang: string;
}> {
  if (!NativeModule || typeof NativeModule.mlkitCheckModel !== 'function') {
    return {
      sourceDownloaded: false,
      targetDownloaded: false,
      ready: false,
      sourceLang,
      targetLang,
    };
  }
  try {
    return await NativeModule.mlkitCheckModel(sourceLang, targetLang);
  } catch (err) {
    console.warn('[ScreenOverlay] mlkitCheckModel 异常:', err);
    return {
      sourceDownloaded: false,
      targetDownloaded: false,
      ready: false,
      sourceLang,
      targetLang,
    };
  }
}

/**
 * 触发下载 Google ML Kit 端侧离线翻译模型 (每个语言包约 30MB)
 */
export async function mlkitDownloadModel(
  sourceLang: string = 'ja',
  targetLang: string = 'zh',
  requireWifi: boolean = false
): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.mlkitDownloadModel !== 'function') {
    return false;
  }
  try {
    return Boolean(await NativeModule.mlkitDownloadModel(sourceLang, targetLang, requireWifi));
  } catch (err) {
    console.warn('[ScreenOverlay] mlkitDownloadModel 异常:', err);
    return false;
  }
}

/**
 * 单句 Google ML Kit 端侧离线翻译 (极速 20~50ms，无需联网)
 */
export async function mlkitTranslate(
  text: string,
  sourceLang: string = 'ja',
  targetLang: string = 'zh'
): Promise<string> {
  if (!text || !text.trim()) return '';
  if (!NativeModule || typeof NativeModule.mlkitTranslate !== 'function') {
    throw new Error('MLKIT_NOT_SUPPORTED: 端侧 ML Kit 翻译模块未在当前编译版本中找到');
  }
  return await NativeModule.mlkitTranslate(text, sourceLang, targetLang);
}

/**
 * 批量 Google ML Kit 端侧离线翻译 (多气泡并行加速)
 */
export async function mlkitTranslateBatch(
  items: Record<string, string>,
  sourceLang: string = 'ja',
  targetLang: string = 'zh'
): Promise<Record<string, string>> {
  if (Object.keys(items).length === 0) return {};
  if (!NativeModule || typeof NativeModule.mlkitTranslateBatch !== 'function') {
    throw new Error('MLKIT_NOT_SUPPORTED: 端侧 ML Kit 批量翻译模块未在当前编译版本中找到');
  }
  return await NativeModule.mlkitTranslateBatch(items, sourceLang, targetLang);
}

/**
 * 检查当前原生运行环境是否支持 ONNX Runtime 端侧本地翻译引擎
 */
export function isOnnxTranslateSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  if (!NativeModule || typeof NativeModule.isOnnxTranslateSupported !== 'function') return false;
  try {
    return Boolean(NativeModule.isOnnxTranslateSupported());
  } catch {
    return false;
  }
}

/**
 * 检查 ONNX 端侧翻译模型是否已经加载完成
 */
export function isOnnxTranslateReady(): boolean {
  if (!NativeModule || typeof NativeModule.isOnnxTranslateReady !== 'function') return false;
  try {
    return Boolean(NativeModule.isOnnxTranslateReady());
  } catch {
    return false;
  }
}

/**
 * 获取 ONNX 端侧翻译引擎当前状态文字
 */
export function getOnnxTranslateStatus(): string {
  if (!NativeModule || typeof NativeModule.getOnnxTranslateStatus !== 'function') return '未加载';
  try {
    return String(NativeModule.getOnnxTranslateStatus());
  } catch {
    return '加载异常';
  }
}

/**
 * 检查 ONNX 端侧翻译模型文件详情（已安装文件、模型类型与目标目录）
 */
export async function onnxCheckModel(): Promise<{
  ready: boolean;
  modelType: string;
  statusMessage: string;
  installedFiles: string[];
  targetDirectory: string;
}> {
  if (!NativeModule || typeof NativeModule.onnxCheckModel !== 'function') {
    return {
      ready: false,
      modelType: 'none',
      statusMessage: '未接入原生模块',
      installedFiles: [],
      targetDirectory: '',
    };
  }
  try {
    return await NativeModule.onnxCheckModel();
  } catch (err: any) {
    return {
      ready: false,
      modelType: 'none',
      statusMessage: err?.message || '检查模型异常',
      installedFiles: [],
      targetDirectory: '',
    };
  }
}

/**
 * 单句 ONNX Runtime 端侧本地漫画汉化翻译
 */
export async function onnxTranslate(text: string): Promise<string> {
  if (!text || !text.trim()) return '';
  if (!NativeModule || typeof NativeModule.onnxTranslate !== 'function') {
    return text;
  }
  return await NativeModule.onnxTranslate(text);
}

/**
 * 批量 ONNX Runtime 端侧本地漫画汉化翻译 (全屏气泡协程加速)
 */
export async function onnxTranslateBatch(
  items: Record<string, string>
): Promise<Record<string, string>> {
  if (Object.keys(items).length === 0) return {};
  if (!NativeModule || typeof NativeModule.onnxTranslateBatch !== 'function') {
    return items;
  }
  return await NativeModule.onnxTranslateBatch(items);
}

export interface OnnxDownloadProgress {
  status: 'idle' | 'downloading' | 'extracting' | 'completed' | 'error' | 'cancelled';
  progress: number; // 0.0 ~ 1.0, 若未知则为 -1
  downloadedBytes: number;
  totalBytes: number;
  speedKbps: number;
  error: string;
  targetFileName: string;
}

export interface InstalledModelFile {
  name: string;
  sizeBytes: number;
  sizeFormatted: string;
  lastModified: number;
  isActive?: boolean;
}

/**
 * 检查当前手机上运行的 APK 原生底包是否支持 ONNX 原生下载功能
 */
export function isOnnxDownloadSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  return Boolean(NativeModule && typeof NativeModule.onnxDownloadModel === 'function');
}

/**
 * 后台下载指定的端侧神经网络模型文件或压缩包（自动解压并就绪）
 */
export async function onnxDownloadModel(
  url: string,
  targetFileName: string
): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.onnxDownloadModel !== 'function') {
    throw new Error(
      '当前手机安装的 APK 是旧版原生底包，未包含最新加入的 Kotlin 下载与 ONNX 翻译模块。\n\n💡 原因：Metro 仅能热重载前端 JS 界面，底层 Kotlin 原生代码需要重新编译打包 APK。\n\n👉 解决方案：请重新编译打包并安装最新 APK（运行 npx expo run:android 或 eas build）。'
    );
  }
  return Boolean(await NativeModule.onnxDownloadModel(url, targetFileName));
}

/**
 * 实时获取当前 ONNX 模型下载状态与进度
 */
export function onnxGetDownloadProgress(): OnnxDownloadProgress {
  const fallback: OnnxDownloadProgress = {
    status: 'idle',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speedKbps: 0,
    error: '',
    targetFileName: '',
  };
  if (!NativeModule || typeof NativeModule.onnxGetDownloadProgress !== 'function') {
    return fallback;
  }
  try {
    return { ...fallback, ...NativeModule.onnxGetDownloadProgress() };
  } catch {
    return fallback;
  }
}

/**
 * 中止当前正在执行的 ONNX 模型下载任务
 */
export function onnxCancelDownload(): void {
  if (NativeModule && typeof NativeModule.onnxCancelDownload === 'function') {
    try {
      NativeModule.onnxCancelDownload();
    } catch {}
  }
}

/**
 * 删除本地已下载的指定模型文件或一键清空翻译模型目录以释放存储
 */
export async function onnxDeleteModelFile(fileName?: string): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.onnxDeleteModelFile !== 'function') {
    return false;
  }
  try {
    return Boolean(await NativeModule.onnxDeleteModelFile(fileName || ''));
  } catch {
    return false;
  }
}

/**
 * 获取本地存储中已安装的所有 ONNX 模型文件列表及占用空间
 */
export function onnxListModelFiles(): InstalledModelFile[] {
  if (!NativeModule || typeof NativeModule.onnxListModelFiles !== 'function') {
    return [];
  }
  try {
    return NativeModule.onnxListModelFiles() || [];
  } catch {
    return [];
  }
}

/**
 * 设置并自主切换当前激活的 ONNX 翻译模型文件
 */
export async function onnxSetActiveModel(modelFileName: string): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.onnxSetActiveModel !== 'function') {
    return false;
  }
  try {
    return Boolean(await NativeModule.onnxSetActiveModel(modelFileName));
  } catch {
    return false;
  }
}

/**
 * 获取当前已激活并生效的 ONNX 翻译模型文件名
 */
export function onnxGetActiveModel(): string {
  if (!NativeModule || typeof NativeModule.onnxGetActiveModel !== 'function') {
    return '';
  }
  try {
    return String(NativeModule.onnxGetActiveModel() || '');
  } catch {
    return '';
  }
}

/**
 * 重新加载并初始化本地 ONNX 翻译引擎
 */
export async function onnxReloadModel(): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.onnxReloadModel !== 'function') {
    return false;
  }
  try {
    return Boolean(await NativeModule.onnxReloadModel());
  } catch {
    return false;
  }
}

/**
 * 删除本地已下载的 Google ML Kit 离线翻译模型以释放存储
 */
export async function mlkitDeleteModel(
  sourceLang: string = 'ja',
  targetLang: string = 'zh'
): Promise<boolean> {
  if (!NativeModule || typeof NativeModule.mlkitDeleteModel !== 'function') {
    return false;
  }
  try {
    return Boolean(await NativeModule.mlkitDeleteModel(sourceLang, targetLang));
  } catch {
    return false;
  }
}





