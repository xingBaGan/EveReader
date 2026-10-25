import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Text,
  Pressable,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';
import { ReaderTopBar } from './ReaderTopBar';
import { ReaderBottomBar } from './ReaderBottomBar';
import { ReaderSettingsModal } from './ReaderSettingsModal';
import { ReaderTocDrawer } from './ReaderTocDrawer';
import { ReaderBookmarksModal } from './ReaderBookmarksModal';
import { ReaderSearchModal } from './ReaderSearchModal';
import { TxtReaderView } from './TxtReaderView';
import { ReaderWebView, ReaderWebViewRef } from './ReaderWebView';
import { READER_BUNDLE_HTML } from './readerTemplate';
import { readBookAsBase64 } from '../../utils/fileStorage';
import { X } from 'lucide-react-native';

export function ReaderModal() {
  const isOpen = useReaderStore((s) => s.isOpen);
  const currentBook = useReaderStore((s) => s.currentBook);
  const currentCfi = useReaderStore((s) => s.currentCfi);
  const settings = useReaderStore((s) => s.settings);
  const isBarsVisible = useReaderStore((s) => s.isBarsVisible);
  const closeReader = useReaderStore((s) => s.closeReader);
  const toggleBars = useReaderStore((s) => s.toggleBars);
  const setToc = useReaderStore((s) => s.setToc);
  const onRelocated = useReaderStore((s) => s.onRelocated);
  const setSearchResults = useReaderStore((s) => s.setSearchResults);
  const setIsSearching = useReaderStore((s) => s.setIsSearching);

  const webViewRef = useRef<ReaderWebViewRef>(null);
  const [base64Content, setBase64Content] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isTxt = currentBook?.extension.toLowerCase() === 'txt';

  // Load Book Data
  useEffect(() => {
    if (!isOpen || !currentBook) {
      setBase64Content(null);
      setError(null);
      return;
    }

    if (isTxt) {
      // Handled directly by TxtReaderView
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        if (!currentBook.localUri) {
          throw new Error('未找到图书本地离线文件路径');
        }

        const b64 = await readBookAsBase64(currentBook.localUri);
        if (isMounted) {
          setBase64Content(b64);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || '加载图书数据失败');
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentBook?.id, currentBook?.localUri]);

  // Handle messages from WebView reader engine
  const handleWebViewMessage = (data: any) => {
    switch (data.type) {
      case 'readerReady':
        if (base64Content) {
          webViewRef.current?.postMessage('initBook', {
            base64Data: base64Content,
            initialCfi: currentCfi,
            settings,
          });
        }
        break;
      case 'toggleBars':
        toggleBars();
        break;
      case 'tocLoaded':
        if (Array.isArray(data.toc)) {
          setToc(data.toc);
        }
        break;
      case 'relocated':
        onRelocated(data.cfi, data.progress);
        break;
      case 'searchResults':
        setSearchResults(data.results || []);
        break;
      case 'error':
        setError(data.message || '阅读引擎内部错误');
        break;
      default:
        break;
    }
  };

  // Sync settings changes to WebView
  useEffect(() => {
    if (!isTxt && webViewRef.current) {
      webViewRef.current.postMessage('applySettings', { settings });
    }
  }, [settings]);

  // Actions passed to UI controls
  const handlePrevChapter = () => {
    webViewRef.current?.postMessage('prevPage');
  };

  const handleNextChapter = () => {
    webViewRef.current?.postMessage('nextPage');
  };

  const handleSeekProgress = (progress: number) => {
    webViewRef.current?.postMessage('goToProgress', { progress });
  };

  const handleSelectChapter = (href: string) => {
    webViewRef.current?.postMessage('goToCfi', { cfi: href });
  };

  const handleSelectBookmarkOrSearch = (cfi: string) => {
    webViewRef.current?.postMessage('goToCfi', { cfi });
  };

  const handleSearch = (query: string) => {
    setIsSearching(true);
    webViewRef.current?.postMessage('search', { query });
  };

  if (!isOpen || !currentBook) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={closeReader}>
      <StatusBar
        style={
          settings.theme === 'dark' || settings.theme === 'black' ? 'light' : 'dark'
        }
        hidden={!isBarsVisible}
      />

      <View style={[styles.container, { backgroundColor: themeConfig.bg }]}>
        {/* Top Control Bar */}
        {isBarsVisible ? <ReaderTopBar /> : null}

        {/* Reader Core Canvas */}
        {error ? (
          <View style={styles.centerBox}>
            <Text style={[styles.errorText, { color: themeConfig.text }]}>{error}</Text>
            <Pressable style={styles.closeErrorBtn} onPress={closeReader}>
              <X size={16} color="#fff" />
              <Text style={styles.closeErrorBtnText}>返回书架</Text>
            </Pressable>
          </View>
        ) : isTxt && currentBook.localUri ? (
          <TxtReaderView uri={currentBook.localUri} onToggleBars={toggleBars} />
        ) : loading || !base64Content ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#0284c7" />
            <Text style={[styles.loadingText, { color: themeConfig.text }]}>
              正在准备图书《{currentBook.title}》...
            </Text>
          </View>
        ) : (
          <ReaderWebView
            ref={webViewRef}
            html={READER_BUNDLE_HTML}
            onMessage={handleWebViewMessage}
            style={styles.webView}
          />
        )}

        {/* Bottom Control Bar */}
        {isBarsVisible ? (
          <ReaderBottomBar
            onPrevChapter={handlePrevChapter}
            onNextChapter={handleNextChapter}
            onSeekProgress={handleSeekProgress}
          />
        ) : null}

        {/* Drawers and Modals */}
        <ReaderSettingsModal />
        <ReaderTocDrawer onSelectChapter={handleSelectChapter} />
        <ReaderBookmarksModal onSelectBookmark={handleSelectBookmarkOrSearch} />
        <ReaderSearchModal
          onSearch={handleSearch}
          onSelectResult={handleSelectBookmarkOrSearch}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 14,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  closeErrorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  closeErrorBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
