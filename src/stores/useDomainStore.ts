import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { Config } from '../constants/config';

const DEFAULT_MIRRORS = Config.FALLBACK_MIRRORS;

interface DomainState {
  currentBaseUrl: string;
  customProxyUrl: string;
  candidateDomains: string[];
  isProbing: boolean;
  setCustomProxyUrl: (url: string) => void;
  setCurrentBaseUrl: (url: string) => void;
  setCandidateDomains: (domains: string[]) => void;
  probeFastestDomain: () => Promise<string>;
  switchToNextAvailableDomain: () => Promise<string>;
}

const customStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(name)
        : null;
    }
    return await SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(name, value);
      }
      return;
    }
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(name);
      }
      return;
    }
    await SecureStore.deleteItemAsync(name);
  },
};

export const useDomainStore = create<DomainState>()(
  persist(
    (set, get) => ({
      currentBaseUrl: DEFAULT_MIRRORS[0],
      customProxyUrl: DEFAULT_MIRRORS[0],
      candidateDomains: DEFAULT_MIRRORS,
      isProbing: false,

      setCustomProxyUrl: (url: string) => {
        const trimmed = url.trim().replace(/\/+$/, '');
        set({
          customProxyUrl: trimmed,
          currentBaseUrl: trimmed || get().candidateDomains[0],
        });
      },

      setCurrentBaseUrl: (url: string) => {
        set({ currentBaseUrl: url.replace(/\/+$/, '') });
      },

      setCandidateDomains: (domains: string[]) => {
        const cleaned = domains.map((d) => d.replace(/\/+$/, ''));
        set({ candidateDomains: cleaned });
      },

      probeFastestDomain: async () => {
        const { customProxyUrl, candidateDomains } = get();
        // If user configured a custom proxy, prioritize using it
        if (customProxyUrl) {
          set({ currentBaseUrl: customProxyUrl });
          return customProxyUrl;
        }

        set({ isProbing: true });

        const testDomain = async (url: string): Promise<string> => {
          const response = await axios.get(`${url}/eapi/info/service`, {
            timeout: 4000,
            headers: {
              'Authorization': Config.CLIENT_SECRET,
              'source': 'android',
            },
          });
          if (response.status === 200) {
            return url;
          }
          throw new Error(`Domain ${url} returned status ${response.status}`);
        };

        try {
          const fastest = await Promise.any(candidateDomains.map(testDomain));
          set({ currentBaseUrl: fastest, isProbing: false });
          return fastest;
        } catch {
          const fallback = candidateDomains[0] || DEFAULT_MIRRORS[0];
          set({ currentBaseUrl: fallback, isProbing: false });
          return fallback;
        }
      },

      switchToNextAvailableDomain: async () => {
        const { currentBaseUrl, candidateDomains } = get();
        const available = candidateDomains.filter((d) => d !== currentBaseUrl);
        if (available.length > 0) {
          const next = available[0];
          set({ currentBaseUrl: next });
          return next;
        }
        return currentBaseUrl;
      },
    }),
    {
      name: 'zlib_domain_storage',
      storage: createJSONStorage(() => customStorage),
    }
  )
);
