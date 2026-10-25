export type ReaderThemeId = 'light' | 'sepia' | 'mint' | 'dark' | 'black';

export interface ReaderThemeConfig {
  id: ReaderThemeId;
  name: string;
  bg: string;
  text: string;
  barBg: string;
  barBorder: string;
  barText: string;
  footerText: string;
}

export const READER_THEMES: Record<ReaderThemeId, ReaderThemeConfig> = {
  light: {
    id: 'light',
    name: '纯净白',
    bg: '#ffffff',
    text: '#1e293b',
    barBg: '#f8fafc',
    barBorder: '#e2e8f0',
    barText: '#0f172a',
    footerText: '#94a3b8',
  },
  sepia: {
    id: 'sepia',
    name: '羊皮纸',
    bg: '#f6f1e7',
    text: '#382c1e',
    barBg: '#ede5d4',
    barBorder: '#dcd2bd',
    barText: '#2e2316',
    footerText: '#8c8273',
  },
  mint: {
    id: 'mint',
    name: '护眼绿',
    bg: '#e2ede0',
    text: '#1d3319',
    barBg: '#d3e4d0',
    barBorder: '#c0d4bd',
    barText: '#152612',
    footerText: '#6b7d68',
  },
  dark: {
    id: 'dark',
    name: '暗夜灰',
    bg: '#18191a',
    text: '#cbd5e1',
    barBg: '#242526',
    barBorder: '#3a3b3c',
    barText: '#f1f5f9',
    footerText: '#64748b',
  },
  black: {
    id: 'black',
    name: '极黑',
    bg: '#000000',
    text: '#94a3b8',
    barBg: '#121212',
    barBorder: '#27272a',
    barText: '#ffffff',
    footerText: '#52525b',
  },
};

export interface ReaderSettings {
  fontSize: number;          // 14 ~ 32
  lineHeight: number;        // 1.3 ~ 2.2
  theme: ReaderThemeId;
  flow: 'paginated' | 'scrolled';
  fontFamily: 'system' | 'serif' | 'kaiti';
}

export interface TocItem {
  id: string;
  href: string;
  label: string;
  subitems?: TocItem[];
}

export interface BookmarkItem {
  id: string;
  bookId: string | number;
  cfiOrLocation: string;
  chapterTitle?: string;
  excerpt: string;
  percentage: number;
  createdAt: number;
}

export interface SearchMatchItem {
  cfi: string;
  excerpt: string;
}

export interface BookshelfItem {
  id: string | number;
  title: string;
  author?: string;
  cover?: string;
  extension: string;
  filesizeString?: string;
  localUri?: string;
  dateAdded: number;
  lastReadTime?: number;
  progress: number;            // 0 - 100
  currentLocation?: string;    // CFI or char index
  currentChapter?: string;
  readingMinutes?: number;
  source: 'download' | 'imported';
}
