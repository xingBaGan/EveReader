import { TextBubble } from '../types/manga';
import { isScreenTranslatorSupported, recognizeImageNative } from './screenTranslatorBridge';

/**
 * 执行气泡检测流程
 * @param pageNum 当前页码
 * @param base64DataUrl 当前页面的快照图片 Base64 DataURL
 * @param originalWidth 页面原始宽度
 * @param originalHeight 页面原始高度
 */
export async function detectBubblesForPage(
  pageNum: number,
  base64DataUrl?: string,
  originalWidth: number = 600,
  originalHeight: number = 800
): Promise<TextBubble[]> {
  // 1. 尝试调用原生端侧深度学习检测器 (ComicTextDetector RT-DETR + MangaOcrProcessor)
  if (isScreenTranslatorSupported() && base64DataUrl) {
    try {
      const res = await recognizeImageNative(base64DataUrl, 'ja');
      if (res && res.bubbles && res.bubbles.length > 0) {
        const imgW = res.width || originalWidth || 1;
        const imgH = res.height || originalHeight || 1;

        const nativeBubbles: TextBubble[] = res.bubbles.map((b: any, index: number) => {
          const rawX = b.x ?? b.bounds?.left ?? (b.box?.x ?? 0);
          const rawY = b.y ?? b.bounds?.top ?? (b.box?.y ?? 0);
          const rawW = b.width ?? (b.bounds ? b.bounds.right - b.bounds.left : (b.box?.width ?? 100));
          const rawH = b.height ?? (b.bounds ? b.bounds.bottom - b.bounds.top : (b.box?.height ?? 80));

          return {
            id: `bubble_p${pageNum}_${index}_${Date.now()}`,
            // 归一化为纯百分比坐标 (0.0% ~ 100.0%)
            box: {
              x: Number(((rawX / imgW) * 100).toFixed(2)),
              y: Number(((rawY / imgH) * 100).toFixed(2)),
              width: Number(((rawW / imgW) * 100).toFixed(2)),
              height: Number(((rawH / imgH) * 100).toFixed(2)),
            },
            direction: b.direction === 'horizontal' ? 'horizontal' : 'vertical',
            readingOrderIndex: index + 1,
            sourceText: b.text || b.sourceText || '',
            targetText: b.targetText || '',
            detectedBgColor: b.detectedBgColor || '#FFFFFF',
            detectedTextColor: b.detectedTextColor || '#18181B',
            confidence: b.confidence ?? 0.95,
            textType: b.textType || (b.category === 2 ? 'sfx' : 'bubble'),
            fontSize: b.fontSize,
            detectedLang: b.detectedLang || 'ja',
            langName: b.langName || '日语',
          };
        });

        return nativeBubbles;
      }
    } catch (err) {
      console.warn('[MangaDetector] 原生识别调用异常:', err);
    }
  }

  // 2. 在非原生编译环境（如 Expo Go / Web）中，主检测流程由 WebView 内置的 Canvas 计算机视觉内核
  // 直接以 0 拷贝、10ms 极速在真实渲染像素上动态完成，严禁返回伪造写死气泡！
  return [];
}
