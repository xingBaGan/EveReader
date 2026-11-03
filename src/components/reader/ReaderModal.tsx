import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Text,
  Pressable,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar, setVisibilityAsync } from 'expo-navigation-bar';
import { useReaderStore } from '../../stores/useReaderStore';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { READER_THEMES } from '../../types/reader';
import { ReaderTopBar } from './ReaderTopBar';
import { ReaderBottomBar } from './ReaderBottomBar';
import { ReaderFooterBar } from './ReaderFooterBar';
import { ReaderSettingsModal } from './ReaderSettingsModal';
import { ReaderTocDrawer } from './ReaderTocDrawer';
import { ReaderBookmarksModal } from './ReaderBookmarksModal';
import { ReaderSearchModal } from './ReaderSearchModal';
import { TxtReaderView } from './TxtReaderView';
import { ReaderWebView, ReaderWebViewRef } from './ReaderWebView';
import { BubbleFloatingPill } from './BubbleFloatingPill';
import { BubbleDetailModal } from './BubbleDetailModal';
import { detectBubblesForPage } from '../../utils/mangaDetector';
import { READER_BUNDLE_HTML } from './readerTemplate';
import { PDF_BUNDLE_HTML } from './pdfTemplate';
import { readBookAsBase64, streamFileToWebView } from '../../utils/fileStorage';
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
  const currentPage = useReaderStore((s) => s.currentPage);
  const isBubbleDetectActive = useReaderStore((s) => s.isBubbleDetectActive);
  const toggleBubbleDetection = useReaderStore((s) => s.toggleBubbleDetection);
  const setIsDetectingBubbles = useReaderStore((s) => s.setIsDetectingBubbles);
  const setDetectedBubbles = useReaderStore((s) => s.setDetectedBubbles);
  const selectedBubble = useReaderStore((s) => s.selectedBubble);
  const setSelectedBubble = useReaderStore((s) => s.setSelectedBubble);

  const webViewRef = useRef<ReaderWebViewRef>(null);
  const isStreamingRef = useRef(false);
  const nextReqIdRef = useRef(1);
  const activeRequestIdRef = useRef(0);
  const inFlightRequestRef = useRef(false);
  const [base64Content, setBase64Content] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isTxt = currentBook?.extension.toLowerCase() === 'txt';
  const isPdf = currentBook?.extension.toLowerCase() === 'pdf';

  // Manage Android native navigation bar visibility (Collapse in reading mode)
  useEffect(() => {
    if (Platform.OS === 'android') {
      setVisibilityAsync(!isBarsVisible ? 'hidden' : 'visible').catch(() => {});
    }
    return () => {
      if (Platform.OS === 'android') {
        setVisibilityAsync('visible').catch(() => {});
      }
    };
  }, [isOpen, isBarsVisible]);

  // Load Book Data for EPUB
  useEffect(() => {
    isStreamingRef.current = false;
    if (!isOpen || !currentBook) {
      setBase64Content(null);
      setError(null);
      return;
    }

    if (isTxt || isPdf) {
      // Handled directly by TxtReaderView or streamFileToWebView to avoid Java Heap OOM
      setLoading(false);
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
  }, [isOpen, currentBook?.id, currentBook?.localUri, isTxt, isPdf]);

  // Handle messages from WebView reader engine (EPUB & PDF)
  const handleWebViewMessage = (data: any) => {
    switch (data.type) {
      case 'readerReady':
        // EPUB engine ready
        if (base64Content && !isPdf) {
          webViewRef.current?.postMessage('initBook', {
            base64Data: base64Content,
            initialCfi: currentCfi,
            settings,
          });
        }
        break;

      case 'pdfReaderReady':
        // PDF engine ready! Stream file in small safe chunks to prevent Android JVM OOM
        if (currentBook?.localUri && isPdf && !isStreamingRef.current) {
          isStreamingRef.current = true;
          const initialPage = currentBook?.currentLocation
            ? parseInt(currentBook.currentLocation, 10) || 1
            : 1;

          streamFileToWebView(
            currentBook.localUri,
            (totalBytes) => {
              webViewRef.current?.postMessage('initPdfStream', { totalBytes });
            },
            (chunkData, isLastChunk) => {
              webViewRef.current?.postMessage('appendPdfChunk', {
                chunkData,
                isLastChunk,
                initialPage,
                theme: settings.theme,
              });
              if (isLastChunk) {
                isStreamingRef.current = false;
              }
            }
          ).catch((err: any) => {
            isStreamingRef.current = false;
            setError('读取文档失败: ' + (err.message || String(err)));
          });
        }
        break;

      case 'coverExtracted':
        // High-resolution cover extracted from PDF or EPUB!
        if (data.cover && currentBook) {
          useBookshelfStore.getState().addOrUpdateBook({
            id: currentBook.id,
            title: currentBook.title,
            cover: data.cover,
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

      case 'pdfLoaded':
        if (data.totalPages) {
          useReaderStore.getState().setPageInfo(data.currentPage || 1, data.totalPages);
        }
        break;

      case 'locationsReady':
        if (data.totalLocations) {
          useReaderStore.getState().setPageInfo(
            useReaderStore.getState().currentPage,
            data.totalLocations
          );
        }
        break;

      case 'relocated':
        if (isPdf) {
          onRelocated(
            String(data.currentPage),
            data.progress,
            data.chapterTitle || `第 ${data.currentPage} / ${data.totalPages} 页`,
            data.currentPage,
            data.totalPages
          );
        } else {
          onRelocated(
            data.cfi,
            data.progress,
            data.chapterTitle,
            data.currentPage,
            data.totalPages
          );
        }
        break;

      case 'searchResults':
        setSearchResults(data.results || []);
        break;

      case 'bubblesDetected':
        if (Array.isArray(data.bubbles)) {
          setDetectedBubbles(data.bubbles);
          setIsDetectingBubbles(false);
        }
        break;

      case 'requestBubbleDetection': {
        const reqId = data.requestId || ++nextReqIdRef.current;
        const targetPage = data.pageNum || currentPage || 1;
        const snapshotLen = data.snapshot ? data.snapshot.length : 0;

        // In-flight 幂等防护：若当前请求正在进行，重复请求坚决丢弃，绝不发起重复 OCR
        if (inFlightRequestRef.current && reqId <= activeRequestIdRef.current) {
          console.warn(`[BubbleOCR] [ERROR_OR_CANCEL] Duplicate in-flight request dropped: reqId=${reqId}, active=${activeRequestIdRef.current}`);
          break;
        }

        activeRequestIdRef.current = reqId;
        inFlightRequestRef.current = true;
        setIsDetectingBubbles(true);

        console.log(`[BubbleOCR] [JS_RECEIPT] reqId=${reqId}, page=${targetPage}, snapshotBytes=${snapshotLen}, width=${data.width}, height=${data.height}`);

        let ackSent = false;
        detectBubblesForPage(targetPage, data.snapshot, data.width, data.height)
          .then((bubbles) => {
            // 时序版本防护：若用户已翻页或发起了新请求，旧请求的识别结果坚决不覆盖当前页面
            if (activeRequestIdRef.current !== reqId || (currentPage && targetPage !== currentPage)) {
              console.warn(`[BubbleOCR] [ERROR_OR_CANCEL] Stale request result ignored: reqId=${reqId}, currentActive=${activeRequestIdRef.current}, reqPage=${targetPage}, currentPage=${currentPage}`);
              webViewRef.current?.postMessage('detectionFailed', {
                reason: 'stale',
                requestId: reqId,
              });
              ackSent = true;
              return;
            }

            console.log(`[BubbleOCR] [FINAL_RESULTS] reqId=${reqId}, page=${targetPage}, returned=${bubbles?.length ?? 0} bubbles`);
            if (bubbles && bubbles.length > 0) {
              setDetectedBubbles(bubbles);
              webViewRef.current?.postMessage('setDetectedBubbles', {
                bubbles,
                active: true,
                requestId: reqId,
              });
              ackSent = true;
            } else {
              // 成功但结果为空（合法 0 气泡）：明确清空 overlay，发送 detectionCompleted ACK 释放 WebView 锁
              setDetectedBubbles([]);
              webViewRef.current?.postMessage('detectionCompleted', {
                bubbles: [],
                active: true,
                requestId: reqId,
              });
              ackSent = true;
            }
          })
          .catch((err) => {
            console.error(`[BubbleOCR] [ERROR_OR_CANCEL] detectBubblesForPage error (reqId=${reqId}):`, err);
            webViewRef.current?.postMessage('detectionFailed', {
              reason: err?.message || 'detection_error',
              requestId: reqId,
            });
            ackSent = true;
          })
          .finally(() => {
            // 无论任何退出路径，finally 兜底确保向 WebView 回传终态 ACK 释放对应请求锁
            if (!ackSent) {
              webViewRef.current?.postMessage('detectionFailed', {
                reason: 'finally_fallback',
                requestId: reqId,
              });
            }
            if (activeRequestIdRef.current === reqId) {
              inFlightRequestRef.current = false;
              setIsDetectingBubbles(false);
            }
          });
        break;
      }

      case 'bubblePressed':
        if (data.bubble) {
          setSelectedBubble(data.bubble);
        }
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
  }, [settings, isTxt]);

  // Sync bubble detection state to WebView (唯一由状态驱动的同步入口，绝不重复派发 runBubbleDetection)
  useEffect(() => {
    if (isPdf && webViewRef.current) {
      const reqId = ++nextReqIdRef.current;
      webViewRef.current.postMessage('toggleBubbleDetection', {
        active: isBubbleDetectActive,
        requestId: reqId,
      });
    }
  }, [isBubbleDetectActive, isPdf]);

  const handleToggleBubbleDetect = () => {
    const nextActive = !isBubbleDetectActive;
    console.log(`[BubbleOCR] [JS_CLICK_ENTRY] handleToggleBubbleDetect clicked, nextActive=${nextActive}, isPdf=${isPdf}`);
    toggleBubbleDetection(nextActive);
  };

  const handleRefreshBubbleDetect = () => {
    console.log(`[BubbleOCR] [JS_CLICK_ENTRY] handleRefreshBubbleDetect clicked, isPdf=${isPdf}`);
    if (isPdf && webViewRef.current) {
      const reqId = ++nextReqIdRef.current;
      setIsDetectingBubbles(true);
      webViewRef.current.postMessage('runBubbleDetection', {
        requestId: reqId,
      });
    }
  };

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
    if (isPdf) {
      const pageNum = parseInt(href, 10);
      if (!isNaN(pageNum)) {
        webViewRef.current?.postMessage('goToPage', { pageNum });
      }
    } else {
      webViewRef.current?.postMessage('goToCfi', { cfi: href });
    }
  };

  const handleSelectBookmarkOrSearch = (location: string) => {
    if (isPdf) {
      const pageNum = parseInt(location, 10);
      if (!isNaN(pageNum)) {
        webViewRef.current?.postMessage('goToPage', { pageNum });
      }
    } else {
      webViewRef.current?.postMessage('goToCfi', { cfi: location });
    }
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
      navigationBarTranslucent
      onRequestClose={closeReader}>
      {Platform.OS === 'android' && <NavigationBar hidden={!isBarsVisible} />}
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
        <View style={styles.bodyContainer}>
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
          ) : !isPdf && (loading || !base64Content) ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#0284c7" />
              <Text style={[styles.loadingText, { color: themeConfig.text }]}>
                正在载入《{currentBook.title}》...
              </Text>
            </View>
          ) : (
            <ReaderWebView
              ref={webViewRef}
              html={isPdf ? PDF_BUNDLE_HTML : READER_BUNDLE_HTML}
              onMessage={handleWebViewMessage}
              style={styles.webView}
            />
          )}
        </View>

        {/* Subtle Footer: Battery & Time on Left, Page Count on Right (NeatReader Style) */}
        {!isBarsVisible && !error ? <ReaderFooterBar /> : null}

        {/* 漫画气泡检测快速悬浮胶囊 (1键开启/关闭/状态展示，阅读无阻碍) */}
        {isPdf && !error ? (
          <BubbleFloatingPill
            onToggle={handleToggleBubbleDetect}
            onRefresh={handleRefreshBubbleDetect}
          />
        ) : null}

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

        {/* 气泡详情与 OCR 原文查看弹窗 */}
        <BubbleDetailModal
          bubble={selectedBubble}
          visible={selectedBubble != null}
          onClose={() => setSelectedBubble(null)}
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
  bodyContainer: {
    flex: 1,
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
