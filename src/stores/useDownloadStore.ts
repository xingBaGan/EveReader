import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { zlibApi } from '../api/endpoints';
import { ZLibBook } from '../types/zlib';
import { useAuthStore } from './useAuthStore';
import { useDomainStore } from './useDomainStore';
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
    // 1. Pre-download authentication guard (Z-Lib requires logged in user quota)
    const user = useAuthStore.getState().user;
    if (!user) {
      Alert.alert(
        '需要登录 Z-Library 账号',
        '下载电子书需要消耗账号每日免费下载额度（普通用户每天 10 本），请先登录您的 Z-Library 账号。',
        [
          { text: '稍后再说', style: 'cancel' },
          {
            text: '前往登录',
            onPress: () => {
              router.push('/profile');
            },
          },
        ]
      );
      return undefined;
    }

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
      // 2. Get signed CDN download link
      const fileData = await zlibApi.getDownloadLink(book.id, book.hash);
      const allowDownload = fileData.file?.allowDownload !== false;
      const dlLink = fileData.file?.dlLink;

      if (fileData.success === 0 || !allowDownload || !dlLink) {
        const errorMsg = fileData.error || fileData.message;
        const isQuotaReached =
          !allowDownload ||
          (errorMsg && errorMsg.toLowerCase().includes('limit')) ||
          (errorMsg && errorMsg.toLowerCase().includes('quota')) ||
          (errorMsg && errorMsg.includes('5 downloads'));

        const isAuthError =
          (errorMsg && errorMsg.toLowerCase().includes('login')) ||
          (errorMsg && errorMsg.toLowerCase().includes('credential')) ||
          (errorMsg && errorMsg.toLowerCase().includes('sign in'));

        if (isQuotaReached) {
          Alert.alert(
            '今日下载配额已达上限',
            '您今日的免费下载额度已达到上限（普通用户每日限额 10 本，未登录 IP 限额 5 本）。额度将在 24 小时后重置，或可通过赞助 Z-Library 提高额度。'
          );
        } else if (isAuthError) {
          Alert.alert(
            '登录凭证已失效',
            '您的登录令牌已过期或失效，请重新登录账号。',
            [
              { text: '稍后再说', style: 'cancel' },
              { text: '前往登录', onPress: () => router.push('/profile') },
            ]
          );
        } else {
          Alert.alert(
            '无法获取下载直链',
            errorMsg || '官方源站暂未开放该文件的直链下载，请稍后重试或尝试在详情页切换格式。'
          );
        }
        set((state) => ({
          tasks: {
            ...state.tasks,
            [book.id]: {
              ...state.tasks[book.id],
              status: 'failed',
              error: errorMsg || '无法获取下载直链',
            },
          },
        }));
        return undefined;
      }

      // Handle relative download links
      let directUrl = dlLink;
      if (directUrl.startsWith('/')) {
        const currentBaseUrl = useDomainStore.getState().currentBaseUrl;
        directUrl = `${currentBaseUrl}${directUrl}`;
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
              localUri: directUrl,
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
          localUri: directUrl,
          source: 'download',
        });

        // Open in reader
        get().openBookInReader(book.id);
        return directUrl;
      }

      // Native platform (iOS/Android): Download using Expo FileSystem API
      const sanitizedTitle = book.title.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `${sanitizedTitle}_${book.id}.${book.extension}`;
      const destinationFile = new File(Paths.document, filename);

      const downloadedFile = await File.downloadFileAsync(directUrl, destinationFile);
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
      const resError = err.response?.data?.error || err.response?.data?.message;
      const status = err.response?.status;
      const msg = resError || err.message || '下载失败';

      if (
        status === 403 ||
        (typeof msg === 'string' &&
          (msg.toLowerCase().includes('login') ||
            msg.toLowerCase().includes('credential') ||
            msg.toLowerCase().includes('sign in')))
      ) {
        Alert.alert(
          '需要登录 Z-Library 账号',
          '下载书籍需要登录 Z-Library 账号以消耗每日额度，请先登录账号。',
          [
            { text: '稍后再说', style: 'cancel' },
            { text: '前往登录', onPress: () => router.push('/profile') },
          ]
        );
      } else if (status === 502) {
        Alert.alert(
          '代理节点未就绪',
          '当前代理节点未连接到官方源站，请确保已在 Cloudflare Worker 中放行状态码（status < 500），或在「我的」页面切换备用镜像节点。'
        );
      } else if (
        typeof msg === 'string' &&
        (msg.toLowerCase().includes('limit') ||
          msg.toLowerCase().includes('quota') ||
          msg.includes('5 downloads'))
      ) {
        Alert.alert(
          '今日下载额度已用完',
          '您今日的免费下载额度已达到上限（普通用户每日限额 10 本，未登录 IP 限额 5 本）。额度将在 24 小时后重置。'
        );
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
