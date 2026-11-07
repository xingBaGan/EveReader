import { TextBubble } from '../types/manga';
import { isScreenTranslatorSupported, recognizeImageNative } from './screenTranslatorBridge';

/**
 * 专为 0~100% 归一化百分比坐标打造的日漫与条漫阅读顺序排序
 * - 日漫/竖排模式：从右向左 (X 降序)、从上向下 (Y 升序)，同列容差 8.0%
 * - 条漫/横排模式：从上向下 (Y 升序)、从左向右 (X 升序)，同行容差 6.0%
 */
export function sortNormalizedReadingOrder(
  bubbles: TextBubble[],
  preferredMode: 'auto' | 'vertical' | 'horizontal' = 'auto'
): TextBubble[] {
  if (bubbles.length <= 1) {
    return bubbles.map((b, i) => ({ ...b, readingOrderIndex: i + 1 }));
  }

  let isVerticalMode = true;
  if (preferredMode === 'horizontal') {
    isVerticalMode = false;
  } else if (preferredMode === 'vertical') {
    isVerticalMode = true;
  } else {
    const verticalCount = bubbles.filter((b) => b.direction === 'vertical').length;
    isVerticalMode = verticalCount >= bubbles.length / 2;
  }

  if (isVerticalMode) {
    // 日漫从右往左 (X 降序)，同列（X 中心差 < 8.0%）从上到下 (Y 升序)
    return [...bubbles]
      .sort((a, b) => {
        const aCenterX = a.box.x + a.box.width / 2;
        const bCenterX = b.box.x + b.box.width / 2;
        const xDiff = bCenterX - aCenterX;
        if (Math.abs(xDiff) < 8.0) {
          return a.box.y - b.box.y;
        }
        return xDiff;
      })
      .map((bubble, index) => ({
        ...bubble,
        readingOrderIndex: index + 1,
      }));
  }

  // 横排条漫从上往下 (Y 升序)，同行（Y 中心差 < 6.0%）从左到右 (X 升序)
  return [...bubbles]
    .sort((a, b) => {
      const aCenterY = a.box.y + a.box.height / 2;
      const bCenterY = b.box.y + b.box.height / 2;
      const yDiff = aCenterY - bCenterY;
      if (Math.abs(yDiff) < 6.0) {
        return a.box.x - b.box.x;
      }
      return yDiff;
    })
    .map((bubble, index) => ({
      ...bubble,
      readingOrderIndex: index + 1,
    }));
}

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
  const dataLen = base64DataUrl ? base64DataUrl.length : 0;
  console.log(`[BubbleOCR] [NATIVE_CALL_START] page=${pageNum}, hasDataUrl=${!!base64DataUrl}, bytes=${dataLen}, size=${originalWidth}x${originalHeight}`);

  // 1. 尝试调用原生端侧深度学习检测器 (ComicTextDetector RT-DETR + MangaOcrProcessor)
  if (isScreenTranslatorSupported() && base64DataUrl) {
    try {
      const res = await recognizeImageNative(base64DataUrl, 'ja');
      const rawCount = res?.bubbles?.length ?? 0;
      console.log(`[BubbleOCR] [NATIVE_CALL_COMPLETE] native module returned ${rawCount} raw bubbles`);

      if (res && res.bubbles && res.bubbles.length > 0) {
        const imgW = res.width || originalWidth || 1;
        const imgH = res.height || originalHeight || 1;

        const nativeBubbles: TextBubble[] = res.bubbles.map((b: any, index: number) => {
          const rawX = b.x ?? b.bounds?.left ?? (b.box?.x ?? 0);
          const rawY = b.y ?? b.bounds?.top ?? (b.box?.y ?? 0);
          const rawW = b.width ?? (b.bounds ? b.bounds.right - b.bounds.left : (b.box?.width ?? 100));
          const rawH = b.height ?? (b.bounds ? b.bounds.bottom - b.bounds.top : (b.box?.height ?? 80));

          const rawChars = Array.isArray(b.chars)
            ? b.chars.map((c: any) => ({
                char: String(c.char || ''),
                score: typeof c.score === 'number' ? c.score : 0.95,
                box: Array.isArray(c.box) && c.box.length === 4
                  ? [
                      Number(c.box[0]),
                      Number(c.box[1]),
                      Number(c.box[2]),
                      Number(c.box[3])
                    ] as [number, number, number, number]
                  : [0, 0, 0, 0] as [number, number, number, number]
              }))
            : undefined;

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
            isPlaceholder: b.isPlaceholder === true,
            targetText: b.targetText || '',
            detectedBgColor: b.detectedBgColor || '#FFFFFF',
            detectedTextColor: b.detectedTextColor || '#18181B',
            confidence: b.confidence ?? 0.95,
            textType: b.textType || (b.category === 2 ? 'sfx' : 'bubble'),
            fontSize: b.fontSize,
            detectedLang: b.detectedLang || 'ja',
            langName: b.langName || '日语',
            chars: rawChars,
          };
        });

        const sorted = sortNormalizedReadingOrder(nativeBubbles, 'auto');
        console.log(`[BubbleOCR] [FINAL_RESULTS] detectBubblesForPage sorted ${sorted.length} bubbles`);
        return sorted;
      }
    } catch (err) {
      console.error('[BubbleOCR] [ERROR_OR_CANCEL] recognizeImageNative error:', err);
    }
  } else if (!isScreenTranslatorSupported()) {
    console.warn('[BubbleOCR] [ERROR_OR_CANCEL] isScreenTranslatorSupported is false, native module not available');
  }

  return [];
}
