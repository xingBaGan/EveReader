import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ZLibUser } from '../types/zlib';

interface AuthState {
  user: ZLibUser | null;
  isLoading: boolean;
  setUser: (user: ZLibUser | null) => Promise<void>;
  loadStoredUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = 'zlib_saved_user';

async function setStorage(key: string, value: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getStorage(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return null;
  }
  return await SecureStore.getItemAsync(key);
}

async function removeStorage(key: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  setUser: async (user: ZLibUser | null) => {
    if (user) {
      await setStorage(STORAGE_KEY, JSON.stringify(user));
    } else {
      await removeStorage(STORAGE_KEY);
    }
    set({ user });
  },

  loadStoredUser: async () => {
    try {
      set({ isLoading: true });
      const raw = await getStorage(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ZLibUser;
        set({ user: parsed });
      }
    } catch (e) {
      console.warn('Failed to load stored user from secure storage:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    await removeStorage(STORAGE_KEY);
    set({ user: null });
  },
}));
