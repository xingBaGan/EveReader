import { create } from 'zustand';
import {
  BookshelfItem,
  ReaderSettings,
  TocItem,
  BookmarkItem,
  SearchMatchItem,
} from '../types/reader';
import { saveJsonFile, loadJsonFile } from '../utils/fileStorage';
import { useBookshelfStore } from './useBookshelfStore';

const READER_SETTINGS_FILE = 'reader_settings_v1.json';
const BOOKMARKS_STORAGE_FILE = 'reader_bookmarks_v1.json';

interface ReaderStoreState {
  isOpen: boolean;
  currentBook: BookshelfItem | null;
  settings: ReaderSettings;
  toc: TocItem[];
  currentCfi: string;
  currentProgress: number;
  currentChapterTitle: string;
  bookmarks: BookmarkItem[];
  searchResults: SearchMatchItem[];
  isSearching: boolean;

  // UI Drawer / Overlay controls
  isBarsVisible: boolean;
  isTocOpen: boolean;
  isSettingsOpen: boolean;
  isSearchOpen: boolean;
  isBookmarksOpen: boolean;

  // Actions
  initSettings: () => Promise<void>;
  openReader: (book: BookshelfItem) => void;
  closeReader: () => void;
  updateSettings: (newSettings: Partial<ReaderSettings>) => void;
  toggleBars: () => void;
  setBarsVisible: (visible: boolean) => void;
  setIsTocOpen: (open: boolean) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setIsSearchOpen: (open: boolean) => void;
  setIsBookmarksOpen: (open: boolean) => void;

  setToc: (toc: TocItem[]) => void;
  onRelocated: (cfi: string, progress: number, chapterTitle?: string) => void;
  addBookmark: (excerpt?: string) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  setSearchResults: (results: SearchMatchItem[]) => void;
  setIsSearching: (val: boolean) => void;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.6,
  theme: 'sepia',
  flow: 'paginated',
  fontFamily: 'system',
};

export const useReaderStore = create<ReaderStoreState>((set, get) => ({
  isOpen: false,
  currentBook: null,
  settings: DEFAULT_SETTINGS,
  toc: [],
  currentCfi: '',
  currentProgress: 0,
  currentChapterTitle: '',
  bookmarks: [],
  searchResults: [],
  isSearching: false,

  isBarsVisible: false,
  isTocOpen: false,
  isSettingsOpen: false,
  isSearchOpen: false,
  isBookmarksOpen: false,

  initSettings: async () => {
    try {
      const savedSettings = await loadJsonFile<ReaderSettings>(READER_SETTINGS_FILE);
      const savedBookmarks = await loadJsonFile<BookmarkItem[]>(BOOKMARKS_STORAGE_FILE);
      if (savedSettings) {
        set({ settings: { ...DEFAULT_SETTINGS, ...savedSettings } });
      }
      if (savedBookmarks) {
        set({ bookmarks: savedBookmarks });
      }
    } catch {
      // fallback to defaults
    }
  },

  openReader: (book) => {
    set({
      isOpen: true,
      currentBook: book,
      currentCfi: book.currentLocation || '',
      currentProgress: book.progress || 0,
      currentChapterTitle: book.currentChapter || '',
      isBarsVisible: false,
      isTocOpen: false,
      isSettingsOpen: false,
      isSearchOpen: false,
      isBookmarksOpen: false,
      searchResults: [],
    });

    // Update book lastReadTime in bookshelf store
    useBookshelfStore.getState().addOrUpdateBook({
      ...book,
      lastReadTime: Date.now(),
    });
  },

  closeReader: () => {
    const { currentBook, currentProgress, currentCfi, currentChapterTitle } = get();
    if (currentBook) {
      useBookshelfStore
        .getState()
        .updateProgress(currentBook.id, currentProgress, currentCfi, currentChapterTitle);
    }
    set({
      isOpen: false,
      currentBook: null,
      isBarsVisible: false,
      isTocOpen: false,
      isSettingsOpen: false,
      isSearchOpen: false,
      isBookmarksOpen: false,
    });
  },

  updateSettings: (newSettings) => {
    const updated = { ...get().settings, ...newSettings };
    set({ settings: updated });
    saveJsonFile(READER_SETTINGS_FILE, updated);
  },

  toggleBars: () => {
    set((s) => ({ isBarsVisible: !s.isBarsVisible }));
  },

  setBarsVisible: (visible) => set({ isBarsVisible: visible }),
  setIsTocOpen: (open) => set({ isTocOpen: open, isBarsVisible: false }),
  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setIsSearchOpen: (open) => set({ isSearchOpen: open, isBarsVisible: false }),
  setIsBookmarksOpen: (open) => set({ isBookmarksOpen: open, isBarsVisible: false }),

  setToc: (toc) => set({ toc }),

  onRelocated: (cfi, progress, chapterTitle) => {
    const book = get().currentBook;
    const title = chapterTitle || get().currentChapterTitle;
    set({
      currentCfi: cfi,
      currentProgress: Math.round(progress * 10) / 10,
      currentChapterTitle: title,
    });

    if (book) {
      useBookshelfStore.getState().updateProgress(book.id, progress, cfi, title);
    }
  },

  addBookmark: async (excerpt) => {
    const { currentBook, currentCfi, currentProgress, currentChapterTitle, bookmarks } = get();
    if (!currentBook) return;

    const newBookmark: BookmarkItem = {
      id: `bm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      bookId: currentBook.id,
      cfiOrLocation: currentCfi,
      chapterTitle: currentChapterTitle || currentBook.title,
      excerpt: excerpt || `阅读至 ${Math.round(currentProgress)}%`,
      percentage: Math.round(currentProgress),
      createdAt: Date.now(),
    };

    const updated = [newBookmark, ...bookmarks];
    set({ bookmarks: updated });
    await saveJsonFile(BOOKMARKS_STORAGE_FILE, updated);
  },

  removeBookmark: async (id) => {
    const updated = get().bookmarks.filter((b) => b.id !== id);
    set({ bookmarks: updated });
    await saveJsonFile(BOOKMARKS_STORAGE_FILE, updated);
  },

  setSearchResults: (results) => set({ searchResults: results, isSearching: false }),
  setIsSearching: (val) => set({ isSearching: val }),
}));
