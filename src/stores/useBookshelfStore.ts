import { create } from 'zustand';
import { BookshelfItem } from '../types/reader';
import { saveJsonFile, loadJsonFile } from '../utils/fileStorage';

const BOOKSHELF_STORAGE_FILE = 'bookshelf_v1.json';

interface BookshelfState {
  books: Record<string | number, BookshelfItem>;
  viewMode: 'grid' | 'list';
  sortBy: 'recent' | 'title' | 'progress' | 'dateAdded';
  filterFormat: 'all' | 'epub' | 'txt' | 'pdf';
  isLoaded: boolean;

  loadBookshelf: () => Promise<void>;
  addOrUpdateBook: (book: Partial<BookshelfItem> & { id: string | number; title?: string }) => Promise<void>;
  updateProgress: (
    bookId: string | number,
    progress: number,
    location?: string,
    chapter?: string
  ) => Promise<void>;
  removeBook: (bookId: string | number) => Promise<void>;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSortBy: (sort: 'recent' | 'title' | 'progress' | 'dateAdded') => void;
  setFilterFormat: (format: 'all' | 'epub' | 'txt' | 'pdf') => void;
  importLocalBook: (name: string, uri: string, size?: number) => Promise<BookshelfItem>;
}

export const useBookshelfStore = create<BookshelfState>((set, get) => ({
  books: {},
  viewMode: 'grid',
  sortBy: 'recent',
  filterFormat: 'all',
  isLoaded: false,

  loadBookshelf: async () => {
    try {
      const saved = await loadJsonFile<{
        books: Record<string | number, BookshelfItem>;
        viewMode?: 'grid' | 'list';
        sortBy?: 'recent' | 'title' | 'progress' | 'dateAdded';
      }>(BOOKSHELF_STORAGE_FILE);

      if (saved) {
        set({
          books: saved.books || {},
          viewMode: saved.viewMode || 'grid',
          sortBy: saved.sortBy || 'recent',
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  addOrUpdateBook: async (bookData) => {
    const existing = get().books[bookData.id];
    const updated: BookshelfItem = {
      id: bookData.id,
      title: bookData.title || existing?.title || '未命名图书',
      author: bookData.author ?? existing?.author,
      cover: bookData.cover ?? existing?.cover,
      extension: (bookData.extension || existing?.extension || 'epub').toLowerCase(),
      filesizeString: bookData.filesizeString ?? existing?.filesizeString,
      localUri: bookData.localUri ?? existing?.localUri,
      dateAdded: existing?.dateAdded || Date.now(),
      lastReadTime: bookData.lastReadTime ?? existing?.lastReadTime,
      progress: bookData.progress ?? existing?.progress ?? 0,
      currentLocation: bookData.currentLocation ?? existing?.currentLocation,
      currentChapter: bookData.currentChapter ?? existing?.currentChapter,
      readingMinutes: bookData.readingMinutes ?? existing?.readingMinutes ?? 0,
      source: bookData.source || existing?.source || 'download',
    };

    const newBooks = {
      ...get().books,
      [bookData.id]: updated,
    };

    set({ books: newBooks });
    await saveJsonFile(BOOKSHELF_STORAGE_FILE, {
      books: newBooks,
      viewMode: get().viewMode,
      sortBy: get().sortBy,
    });
  },

  updateProgress: async (bookId, progress, location, chapter) => {
    const book = get().books[bookId];
    if (!book) return;

    const newProgress = Math.min(100, Math.max(0, Math.round(progress * 10) / 10));
    const updated: BookshelfItem = {
      ...book,
      progress: newProgress,
      currentLocation: location ?? book.currentLocation,
      currentChapter: chapter ?? book.currentChapter,
      lastReadTime: Date.now(),
    };

    const newBooks = {
      ...get().books,
      [bookId]: updated,
    };

    set({ books: newBooks });
    await saveJsonFile(BOOKSHELF_STORAGE_FILE, {
      books: newBooks,
      viewMode: get().viewMode,
      sortBy: get().sortBy,
    });
  },

  removeBook: async (bookId) => {
    const current = { ...get().books };
    delete current[bookId];
    set({ books: current });
    await saveJsonFile(BOOKSHELF_STORAGE_FILE, {
      books: current,
      viewMode: get().viewMode,
      sortBy: get().sortBy,
    });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
    saveJsonFile(BOOKSHELF_STORAGE_FILE, {
      books: get().books,
      viewMode: mode,
      sortBy: get().sortBy,
    });
  },

  setSortBy: (sort) => {
    set({ sortBy: sort });
    saveJsonFile(BOOKSHELF_STORAGE_FILE, {
      books: get().books,
      viewMode: get().viewMode,
      sortBy: sort,
    });
  },

  setFilterFormat: (format) => set({ filterFormat: format }),

  importLocalBook: async (name, uri, size) => {
    // Generate an ID for imported book
    const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const extMatch = name.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
    const extension = extMatch ? extMatch[1].toLowerCase() : 'epub';
    const cleanTitle = name.replace(/\.[^/.]+$/, '');

    let sizeStr = '';
    if (size) {
      if (size < 1024 * 1024) {
        sizeStr = `${(size / 1024).toFixed(1)} KB`;
      } else {
        sizeStr = `${(size / (1024 * 1024)).toFixed(1)} MB`;
      }
    }

    const newItem: BookshelfItem = {
      id,
      title: cleanTitle,
      author: '本地导入',
      extension,
      filesizeString: sizeStr,
      localUri: uri,
      dateAdded: Date.now(),
      progress: 0,
      source: 'imported',
    };

    await get().addOrUpdateBook(newItem);
    return newItem;
  },
}));
