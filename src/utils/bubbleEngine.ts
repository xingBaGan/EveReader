import { BoundingBox, ComicTextType, TextBubble } from '@/types/manga';

/**
 * 竖排阅读顺序重排（日漫从右往左，从上往下）
 * 根据 X 坐标从大到小（右到左）、Y 坐标从小到大（上到下）计算阅读顺序
 */
export function sortJapaneseReadingOrder(bubbles: TextBubble[]): TextBubble[] {
  return [...bubbles]
    .sort((a, b) => {
      // 容差判定：若两文本块在 X 轴相差不大（重叠或同列），优先比较 Y
      const xDiff = (b.box.x + b.box.width / 2) - (a.box.x + a.box.width / 2);
      if (Math.abs(xDiff) < 60) {
        return a.box.y - b.box.y;
      }
      return xDiff;
    })
    .map((bubble, index) => ({
      ...bubble,
      readingOrderIndex: index + 1,
    }));
}

/**
 * 通用漫画阅读顺序排序
 * - 日漫/竖排模式：从右向左 (X 降序)、从上向下 (Y 升序)
 * - 条漫/横排模式：从上向下 (Y 升序)、从左向右 (X 升序)
 * - auto 模式：统计全屏气泡的 direction，若多为 vertical 则按竖排日漫排，否则按横排排
 */
export function sortReadingOrder(
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
    // 自动判定：统计竖排气泡占比
    const verticalCount = bubbles.filter((b) => b.direction === 'vertical').length;
    isVerticalMode = verticalCount >= bubbles.length / 2;
  }

  if (isVerticalMode) {
    return sortJapaneseReadingOrder(bubbles);
  }

  // 横排排序（条漫/Webtoon/国漫/美漫）：Y 轴优先从上到下，同层（Y差<45）从左到右
  return [...bubbles]
    .sort((a, b) => {
      const yDiff = (a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2);
      if (Math.abs(yDiff) < 45) {
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
 * 判断文本是否主要由中日韩 (CJK) 字符组成，可进行地道的单列/多列竖排布局
 */
export function isCJKText(text: string): boolean {
  if (!text) return false;
  const clean = text.replace(/[\s\d\p{P}]+/gu, '');
  if (clean.length === 0) return true;
  let cjkCount = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x31f0 && code <= 0x31ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3000 && code <= 0x303f)
    ) {
      cjkCount++;
    }
  }
  return cjkCount / clean.length >= 0.35;
}

/**
 * 将标点符号或字符映射为竖排专用符号
 */
export function formatVerticalChar(char: string): string {
  switch (char) {
    case 'ー':
    case '―':
    case '—':
      return '丨';
    case '…':
      return '⋮';
    case '（':
    case '(':
      return '︵';
    case '）':
    case ')':
      return '︶';
    case '「':
      return '﹁';
    case '」':
      return '﹂';
    case '『':
      return '﹃';
    case '』':
      return '﹄';
    case '【':
    case '[':
      return '︻';
    case '】':
    case ']':
      return '︼';
    case '《':
      return '︽';
    case '》':
      return '︾';
    case '〈':
      return '︿';
    case '〉':
      return '﹀';
    default:
      return char;
  }
}

/**
 * 规范化并压缩冗长重复字符 (如将过长的 "--------" 或 "――――――" 或 "~~~~~~" 压缩为最多 2 个)
 * 彻底避免界面被大长串横线拉爆变形
 */
export function compressExcessiveRepeatedCharacters(text: string): string {
  if (!text) return '';
  let result = text;
  // 压缩连续 3 个及以上的横线破折号（包括半角减号、全角破折号、日文全角横线、长音符）为最多 2 个破折号 "――"
  result = result.replace(/[-—―─━ー]{3,}/g, '――');
  // 压缩连续 3 个及以上的波浪号为 "~~"
  result = result.replace(/[~〜]{3,}/g, '~~');
  // 压缩连续等号与下划线
  result = result.replace(/={3,}/g, '==');
  result = result.replace(/_{3,}/g, '__');
  // 压缩连续感叹号与问号
  result = result.replace(/[!！]{3,}/g, '！！');
  result = result.replace(/[?？]{3,}/g, '？？');
  // 压缩连续点号与省略号
  result = result.replace(/(?:\.{3,}|…{2,}|[·・]{3,})/g, '……');
  return result;
}

/**
 * 规范化标点与省略号：
 * 消除 "OCR 识别出三个点 ... / …… 占用三整行/过多空间" 的问题
 * 竖排：将所有连续点号（包括带有空格的 . . .）、连续句号、中点、多重省略号等统一压缩为单一垂直省略号 '⋮'，
 * 并消除省略号前的多余空白，避免省略号被独立拆分成空行/单列。
 * 横排：将连续点号规范化压缩为标准简洁的 '…'。
 */
export function normalizeEllipsis(text: string, isVertical: boolean = false): string {
  if (!text) return '';
  let result = compressExcessiveRepeatedCharacters(text);
  if (isVertical) {
    return result
      .replace(/\s*(?:\.(?:\s*\.){1,}|…+|[·・](?:\s*[·・]){1,}|[。]{2,}|[⋮︙]+)/g, '⋮')
      .replace(/\s*…/g, '⋮');
  } else {
    return result.replace(/\s*(?:\.(?:\s*\.){1,}|…{2,}|[·・](?:\s*[·・]){1,}|[。]{2,})/g, '…');
  }
}

export interface VerticalLayoutResult {
  isVerticalLayout: boolean;
  columns: string[];
  fontSize: number;
  charHeight: number;
  colWidth: number;
  paddingH: number;
  paddingV: number;
}

/**
 * 竖排文本多列切分与排版计算
 * 按照日漫/传统排版规则：
 * 1. 优先按空格/换行自然换列（中间有空格时直接换到左侧下一列，绝不在竖列内留出突兀空行）
 * 2. 严格高度保护：根据气泡可用高度自适应字号与字符高度，确保文字决不上下溢出
 * 3. 多列时从右往左流转 (Right-to-Left, 列 0 在最右侧)
 */
export function splitTextIntoVerticalColumns(
  text: string,
  box: BoundingBox,
  scale: number,
  textType: ComicTextType = 'bubble',
  detectedColumnCount?: number,
  originalLines?: string[]
): VerticalLayoutResult {
  const scaledWidth = Math.max(box.width * scale, 12);
  const scaledHeight = Math.max(box.height * scale, 12);
  const cleanText = normalizeEllipsis((text || '').trim(), true);

  // 安全内边距：占宽高的 4%，边界在 2px ~ 5px 之间，贴合圆角/椭圆气泡内部安全区域
  const paddingH = Math.max(2, Math.min(Math.round(scaledWidth * 0.04), 5));
  const paddingV = Math.max(2, Math.min(Math.round(scaledHeight * 0.04), 5));

  const availW = Math.max(scaledWidth - paddingH * 2, 8);
  const availH = Math.max(scaledHeight - paddingV * 2, 8);

  // 优先保留译文自身通过 \n 标记的原作换行；若无显式换行则遵循 originalLines 或自然空白
  const rawSegments = cleanText.includes('\n')
    ? cleanText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : (originalLines && originalLines.length > 0)
    ? originalLines
    : cleanText.split(/[\s]+/).filter(Boolean);

  if (rawSegments.length === 0) {
    return {
      isVerticalLayout: true,
      columns: [],
      fontSize: 12,
      charHeight: 14,
      colWidth: 14,
      paddingH,
      paddingV,
    };
  }

  // 动态字号：底线不低于 8.0px，保障手机屏幕上汉字清晰可读，绝不缩成难以辨认的黑点
  const totalChars = rawSegments.reduce((sum, s) => sum + s.length, 0);
  const baseMaxSize = textType === 'title' ? 24 : textType === 'sfx' ? 22 : 18;
  const dynamicMax = Math.min(22, Math.max(baseMaxSize, Math.floor(availH / Math.max(totalChars / 2, 3))));
  const maxSize = Math.max(14, dynamicMax);
  const minSize = 8.0;

  let bestSize = minSize;
  let bestColumns: string[] = [];
  let bestCharHeight = 10;
  let bestColWidth = 10;

  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const charHeight = Math.ceil(size * 1.18);
    const colWidth = Math.ceil(size * 1.16);
    const colGap = 2;
    const charsPerCol = Math.max(1, Math.floor(availH / charHeight));

    const cols: string[] = [];
    if (rawSegments.length >= 2 || (originalLines && originalLines.length > 0)) {
      // 场景 1：已有天然物理列或分段，严格保持原漫画列数，绝不强行多拆列！
      for (const seg of rawSegments) {
        cols.push(seg);
      }
    } else {
      // 场景 2：单一大段文本，根据 OCR 识别列数或可用高度自然分列
      const targetCols = detectedColumnCount && detectedColumnCount >= 1
        ? detectedColumnCount
        : Math.max(1, Math.ceil(cleanText.length / charsPerCol));
      const charsEach = Math.ceil(cleanText.length / targetCols);
      for (let i = 0; i < targetCols; i++) {
        const chunk = cleanText.slice(i * charsEach, (i + 1) * charsEach);
        if (chunk) cols.push(chunk);
      }
    }

    const neededWidth = cols.length * colWidth + Math.max(0, cols.length - 1) * colGap;
    const maxCharsInCol = Math.max(...cols.map((c) => c.length), 1);
    const neededHeight = maxCharsInCol * charHeight;

    // 严密双向约束：确保列数、总宽度、总高度完整容纳在气泡内，绝对不超出框体
    if (neededWidth <= availW + colGap && neededHeight <= availH) {
      bestSize = size;
      bestColumns = cols;
      bestCharHeight = charHeight;
      bestColWidth = colWidth;
      break;
    }
  }

  // 严密兜底：气泡极小或文字偏长时，保证字号可读 (>= 8.0)，完全沿用原作列数
  if (bestColumns.length === 0) {
    if (rawSegments.length >= 2 || (originalLines && originalLines.length > 0)) {
      bestColumns = rawSegments;
    } else {
      const charsPerCol = Math.max(1, Math.floor(availH / (minSize * 1.18)));
      const targetCols = detectedColumnCount && detectedColumnCount >= 1
        ? detectedColumnCount
        : Math.max(1, Math.ceil(cleanText.length / charsPerCol));
      const charsEach = Math.ceil(cleanText.length / targetCols);
      for (let i = 0; i < targetCols; i++) {
        const chunk = cleanText.slice(i * charsEach, (i + 1) * charsEach);
        if (chunk) bestColumns.push(chunk);
      }
    }
    bestSize = minSize;
    bestCharHeight = Math.ceil(minSize * 1.18);
    bestColWidth = Math.ceil(minSize * 1.16);
  }

  return {
    isVerticalLayout: true,
    columns: bestColumns,
    fontSize: bestSize,
    charHeight: bestCharHeight,
    colWidth: bestColWidth,
    paddingH,
    paddingV,
  };
}

/**
 * 气泡重叠检测与透明度自适应调节
 * 核心原则：坚决不平移不挪动坐标，确保文字永远 100% 紧密贴合漫画原作气泡！
 * 若展示文本发生空间重叠，则将上面覆盖的那层文本的透明度调低 (例如 0.42)，
 * 既能透出下方文本，又保证两个文本都精准定位于原气泡位置！
 */
export function resolveNonOverlappingBubbles(
  bubbles: TextBubble[],
  canvasW: number = 600,
  canvasH: number = 800
): TextBubble[] {
  if (!bubbles || bubbles.length <= 1) return bubbles;

  const result = bubbles.map((b) => ({
    ...b,
    box: { ...b.box },
    overlapOpacity: 1.0,
    isOverlapping: false,
  }));

  // 检测所有两两重叠的气泡
  // 在 DOM 渲染流中，索引较大者 (j > i) 渲染在图层上层，覆盖在先渲染的 (i) 之上
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i];
      const b = result[j];

      const overlapX =
        Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
        Math.max(a.box.x, b.box.x);
      const overlapY =
        Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y);

      if (overlapX > 0 && overlapY > 0) {
        // b 处于上面覆盖层 (在上面的那层)
        // a 压在下面，保持 1.0 不透明度
        // b 调低透明度为 0.72 (字体的透明度别调的太低，保持清晰可辨)
        b.overlapOpacity = 0.72;
        b.isOverlapping = true;
      }
    }
  }

  return result;
}

/**
 * 振假名 (Furigana) 过滤逻辑
 * 日漫中汉字旁边常有小字注音假名，如果 OCR 混在一起通常会带有括号或紧随汉字
 */
export function cleanFuriganaText(rawText: string): string {
  if (!rawText) return '';
  // 过滤括号内的纯假名注音，如 漢字(かんじ) -> 漢字
  let cleaned = rawText.replace(/（[ぁ-んァ-ヶ]+）|\([ぁ-んァ-ヶ]+\)/g, '');
  // 保留换行符以维持漫画原始分行分列排版，但清理行内多余空格与空白
  cleaned = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  // 压缩过长的横线、破折号、长音符或波浪号（杜绝 --------）
  cleaned = compressExcessiveRepeatedCharacters(cleaned);
  return cleaned;
}

export interface OptimalFontResult {
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  paddingH: number;
  paddingV: number;
  isSingleColumn: boolean;
}

/**
 * 自适应字号与排版参数估算
 * 根据目标气泡/文本块类型、宽高与中文字数，计算合适且不溢出的字号 (px)、行高与安全边距
 */
export function calculateOptimalFontSize(
  text: string,
  box: BoundingBox,
  scale: number,
  isVertical: boolean = false,
  textType: ComicTextType = 'bubble'
): OptimalFontResult {
  const scaledWidth = Math.max(box.width * scale, 10);
  const scaledHeight = Math.max(box.height * scale, 10);
  const cleanText = normalizeEllipsis((text || '').trim(), isVertical);
  const charCount = Math.max(cleanText.length, 1);

  // 比例自适应内边距：防止窄长气泡被死边距挤占
  const paddingH = Math.max(1, Math.min(Math.round(scaledWidth * 0.05), 4));
  const paddingV = Math.max(1, Math.min(Math.round(scaledHeight * 0.05), 4));

  const availW = Math.max(scaledWidth - paddingH * 2, 8);
  const availH = Math.max(scaledHeight - paddingV * 2, 8);

  const isNarrowVertical = isVertical || (scaledHeight > scaledWidth * 2.0 && scaledWidth < 36);

  // 1. 标题类型：字号更大，边距更紧凑，富有视觉张力
  if (textType === 'title') {
    const maxSize = Math.min(32, Math.max(12, Math.floor(availH * 0.75)));
    const minSize = 9;
    let bestSize = minSize;

    for (let size = maxSize; size >= minSize; size -= 0.5) {
      const charsPerLine = Math.max(1, Math.floor(availW / (size * 0.95)));
      const lines = Math.ceil(charCount / charsPerLine);
      const lineHeight = Math.round(size * 1.15);
      if (lines * lineHeight <= availH) {
        bestSize = size;
        break;
      }
    }
    const lineHeight = Math.round(bestSize * 1.18);
    const maxLines = Math.max(1, Math.floor(availH / lineHeight));
    return {
      fontSize: bestSize,
      lineHeight,
      maxLines,
      paddingH,
      paddingV,
      isSingleColumn: false,
    };
  }

  // 2. 拟声词 (SFX) 类型：醒目短小，略微倾斜，契合漫画音效动感
  if (textType === 'sfx') {
    const maxSize = Math.min(26, Math.max(10, Math.floor(availH * 0.75)));
    const minSize = 7.5;
    let bestSize = minSize;

    for (let size = maxSize; size >= minSize; size -= 0.5) {
      const charsPerLine = Math.max(1, Math.floor(availW / (size * 0.95)));
      const lines = Math.ceil(charCount / charsPerLine);
      const lineHeight = Math.round(size * 1.15);
      if (lines * lineHeight <= availH) {
        bestSize = size;
        break;
      }
    }
    const lineHeight = Math.round(bestSize * 1.18);
    const maxLines = Math.max(1, Math.floor(availH / lineHeight));
    return {
      fontSize: bestSize,
      lineHeight,
      maxLines,
      paddingH,
      paddingV,
      isSingleColumn: false,
    };
  }

  // 3. 常规对白气泡 (bubble) 与旁白 (free_text)
  // 窄长单列竖排气泡优化：当可用宽度仅够单字排布时
  const isSingleColumn = isNarrowVertical && availW < 22;

  // 上限默认不超过 17px，防止手机屏幕上文字过大显得突兀；下限不低于 8.5px，保障清晰阅读
  const maxSize = Math.min(17, Math.max(9, Math.floor(availW * 0.95)));
  const minSize = 8.5;
  let bestSize = minSize;

  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const charsPerLine = isSingleColumn
      ? 1
      : Math.max(1, Math.floor(availW / (size * 0.96)));
    const lines = Math.ceil(charCount / charsPerLine);
    const lineHeight = Math.round(size * 1.18);
    const totalH = lines * lineHeight;

    if (totalH <= availH && (isSingleColumn || size <= availW)) {
      bestSize = size;
      break;
    }
  }

  const lineHeight = Math.round(bestSize * 1.20);
  const maxLines = Math.max(1, Math.floor(availH / lineHeight));

  return {
    fontSize: bestSize,
    lineHeight,
    maxLines,
    paddingH,
    paddingV,
    isSingleColumn,
  };
}

/**
 * 转换颜色为带透明度的 RGBA 字符串，与漫画背景平滑融为一体
 * @param color 支持 #RGB, #RRGGBB, rgb(...) 或 rgba(...)
 * @param targetOpacity 推荐透明度 0.85 ~ 0.92
 */
export function blendColorWithOpacity(color: string, targetOpacity: number = 0.88): string {
  if (!color) return `rgba(255, 255, 255, ${targetOpacity})`;
  const trimmed = color.trim();

  // 若已经是 rgba(...)
  if (trimmed.startsWith('rgba')) {
    const match = trimmed.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
    if (match) {
      const r = match[1];
      const g = match[2];
      const b = match[3];
      const currentAlpha = parseFloat(match[4]);
      const finalAlpha = Math.min(currentAlpha, targetOpacity);
      return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
    }
    return trimmed;
  }

  // 若是 rgb(...)
  if (trimmed.startsWith('rgb')) {
    const match = trimmed.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${targetOpacity})`;
    }
  }

  // 十六进制颜色
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.substring(0, 2), 16) || 255;
      const g = parseInt(hex.substring(2, 4), 16) || 255;
      const b = parseInt(hex.substring(4, 6), 16) || 255;
      return `rgba(${r}, ${g}, ${b}, ${targetOpacity})`;
    }
  }

  return `rgba(255, 255, 255, ${targetOpacity})`;
}

/**
 * 判断背景颜色是否偏浅亮色
 */
export function isColorLight(color: string): boolean {
  if (!color) return true;
  const trimmed = color.trim();
  let r = 255, g = 255, b = 255;

  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      r = parseInt(hex.substring(0, 2), 16) || 255;
      g = parseInt(hex.substring(2, 4), 16) || 255;
      b = parseInt(hex.substring(4, 6), 16) || 255;
    }
  } else if (trimmed.startsWith('rgb')) {
    const m = trimmed.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0], 10) || 255;
      g = parseInt(m[1], 10) || 255;
      b = parseInt(m[2], 10) || 255;
    }
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
  return luminance > 0.52;
}

/**
 * 智能解析最契合漫画原作印刷风格的译文字体颜色
 */
export function resolveMangaTextColor(bubble: TextBubble, isLightBg: boolean): string {
  // 1. 若气泡自带明确指定的检测文字色 (非默认灰色)
  if (bubble.detectedTextColor && bubble.detectedTextColor !== '#0F172A') {
    return bubble.detectedTextColor;
  }

  // 2. 根据文本类型赋予漫画专属印刷色调
  if (bubble.textType === 'title') {
    return bubble.detectedTextColor || '#C026D3'; // 艺术标题紫/紫红
  }

  if (bubble.textType === 'sfx') {
    return bubble.detectedTextColor || '#DC2626'; // 拟声特效字红/橙红
  }

  if (bubble.textType === 'free_text') {
    return isLightBg ? '#1E293B' : '#F1F5F9';
  }

  // 3. 经典常规对白气泡：日漫高清晰度印刷浓黑油墨色 (Zinc-900 / #18181B)
  return isLightBg ? '#18181B' : '#F8FAFC';
}
