import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import { zlibApi } from '../api/endpoints';
import { ZLibBook } from '../types/zlib';
import { useBookshelfStore } from './useBookshelfStore';
import { useReaderStore } from './useReaderStore';

export interface DownloadTask {
  bookId: number;
  hash: string;
  title: string;
  extension: string;
  cover: string;
  filesizeString: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  localUri?: string;
  error?: string;
}

interface DownloadStoreState {
  tasks: Record<number, DownloadTask>;
  startDownload: (book: ZLibBook) => Promise<string | undefined>;
  openFileWithExternalReader: (bookId: number) => Promise<void>;
  openBookInReader: (bookId: number) => void;
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  tasks: {},

  startDownload: async (book: ZLibBook) => {
    const existing = get().tasks[book.id];
    if (existing && existing.status === 'completed' && existing.localUri) {
      get().openBookInReader(book.id);
      return existing.localUri;
    }

    set((state) => ({
      tasks: {
        ...state.tasks,
        [book.id]: {
          bookId: book.id,
          hash: book.hash,
          title: book.title,
          extension: book.extension,
          cover: book.cover,
          filesizeString: book.filesizeString,
          progress: 0,
          status: 'downloading',
        },
      },
    }));

    try {
      // 1. Get signed CDN download link
      const fileData = await zlibApi.getDownloadLink(book.id, book.hash);
      const dlLink = fileData.file?.dlLink;
      if (!dlLink) {
        throw new Error('未获取到有效下载链接');
      }

      // Web platform fallback: direct download or local blob
      if (Platform.OS === 'web') {
        set((state) => ({
          tasks: {
            ...state.tasks,
            [book.id]: {
              ...state.tasks[book.id],
              progress: 100,
              status: 'completed',
              localUri: dlLink,
            },
          },
        }));

        // Add to bookshelf
        await useBookshelfStore.getState().addOrUpdateBook({
          id: book.id,
          title: book.title,
          author: book.author,
          cover: book.cover,
          extension: book.extension,
          filesizeString: book.filesizeString,
          localUri: dlLink,
          source: 'download',
        });

        // Open in reader
        get().openBookInReader(book.id);
        return dlLink;
      }

      // Native platform (iOS/Android): Download using Expo FileSystem API
      const sanitizedTitle = book.title.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `${sanitizedTitle}_${book.id}.${book.extension}`;
      const destinationFile = new File(Paths.document, filename);

      const downloadedFile = await File.downloadFileAsync(dlLink, destinationFile);
      const localUri = downloadedFile.uri;

      set((state) => ({
        tasks: {
          ...state.tasks,
          [book.id]: {
            ...state.tasks[book.id],
            progress: 100,
            status: 'completed',
            localUri,
          },
        },
      }));

      // Add to bookshelf store automatically
      await useBookshelfStore.getState().addOrUpdateBook({
        id: book.id,
        title: book.title,
        author: book.author,
        cover: book.cover,
        extension: book.extension,
        filesizeString: book.filesizeString,
        localUri,
        source: 'download',
      });

      // Automatically launch built-in reader
      get().openBookInReader(book.id);

      return localUri;
    } catch (err: any) {
      console.error('Download error:', err);
      const msg = err.response?.data?.error || err.message || '下载失败';
      if (
        err.response?.status === 403 ||
        (typeof msg === 'string' && msg.toLowerCase().includes('login'))
      ) {
        Alert.alert('需要登录', '下载书籍需要登录 Z-Library 账号，请在「我的」页面登录后重试。');
      } else {
        Alert.alert('下载失败', String(msg));
      }
      set((state) => ({
        tasks: {
          ...state.tasks,
          [book.id]: {
            ...state.tasks[book.id],
            status: 'failed',
            error: String(msg),
          },
        },
      }));
      return undefined;
    }
  },

  openBookInReader: (bookId: number) => {
    const task = get().tasks[bookId];
    if (task && task.localUri) {
      const bookshelfBook = useBookshelfStore.getState().books[bookId];
      if (bookshelfBook) {
        useReaderStore.getState().openReader(bookshelfBook);
      } else {
        useReaderStore.getState().openReader({
          id: task.bookId,
          title: task.title,
          cover: task.cover,
          extension: task.extension,
          filesizeString: task.filesizeString,
          localUri: task.localUri,
          dateAdded: Date.now(),
          progress: 0,
          source: 'download',
        });
      }
    }
  },

  openFileWithExternalReader: async (bookId: number) => {
    const task = get().tasks[bookId];
    if (task && task.localUri) {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(task.localUri);
      }
    }
  },
}));
