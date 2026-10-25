import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { ReaderModal } from '@/components/reader/ReaderModal';
import { BookDetailModal } from '@/components/book-detail/BookDetailModal';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDomainStore } from '@/stores/useDomainStore';
import { useReaderStore } from '@/stores/useReaderStore';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes cache
    },
  },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const loadStoredUser = useAuthStore((s) => s.loadStoredUser);
  const probeFastestDomain = useDomainStore((s) => s.probeFastestDomain);
  const initReaderSettings = useReaderStore((s) => s.initSettings);

  useEffect(() => {
    // Initialize persistent credentials, domain discovery, and reader settings
    loadStoredUser();
    probeFastestDomain();
    initReaderSettings();
  }, [loadStoredUser, probeFastestDomain, initReaderSettings]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AppTabs />
        <ReaderModal />
        <BookDetailModal />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
