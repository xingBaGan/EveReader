export interface OverlayBubbleBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ComicTextType = 'bubble' | 'free_text' | 'title' | 'sfx';

export interface OverlayBubbleItem {
  id: string;
  box: OverlayBubbleBox;
  sourceText: string;
  targetText: string;
  detectedLang?: string;
  langName?: string;
  langColor?: string;
  direction?: 'vertical' | 'horizontal';
  textType?: ComicTextType;
  detectedBgColor?: string;
  detectedTextColor?: string;
  fontSize?: number;
  columnCount?: number;
  lines?: string[];
  confidence?: number;
}

export interface RecognizeImageResult {
  width: number;
  height: number;
  bubbles: OverlayBubbleItem[];
  error?: string;
}

export interface CapturedScreenEvent {
  uri: string;
  width: number;
  height: number;
  timestamp: number;
  detectedBubbles?: OverlayBubbleItem[];
}

export interface ServiceStateEvent {
  running: boolean;
}

export interface Subscription {
  remove: () => void;
}
