import React, { useRef, useState, useEffect, useCallback } from 'react';
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
import { onnxTranslate, onnxGetActiveModel } from 'screen-translator-overlay';
import { createTranslationRuntime } from '../../translation/runtime';
import { TranslationOrchestrator } from '../../translation/orchestrator';
import { TranslationRequest, DeviceTranslationModel } from '../../translation/types';
import { TextBubble } from '../../types/manga';

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
  const retryVersionRef = useRef(0);
  const translationRuntimeRef = useRef<TranslationOrchestrator | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
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

      case 'relocated': {
        const prevPage = useReaderStore.getState().currentPage;
        const newPage = typeof data.currentPage === 'number' ? data.currentPage : parseInt(data.currentPage, 10);
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

        // 翻页到达新页面时，立即将旧页面的气泡识别状态与图层全部中止并清空
        if (!isNaN(newPage) && newPage !== prevPage) {
          translationAbortRef.current?.abort();
          activeRequestIdRef.current = ++nextReqIdRef.current;
          inFlightRequestRef.current = false;
          setIsDetectingBubbles(false);
          setDetectedBubbles([]);
          setSelectedBubble(null);
        }
        break;
      }

      case 'cancelBubbleDetection': {
        // WebView 触发翻页动作时发出的即时中止信号
        translationAbortRef.current?.abort();
        activeRequestIdRef.current = ++nextReqIdRef.current;
        inFlightRequestRef.current = false;
        setIsDetectingBubbles(false);
        setDetectedBubbles([]);
        setSelectedBubble(null);
        break;
      }

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
        const currentStorePage = useReaderStore.getState().currentPage;
        const targetPage = data.pageNum || currentStorePage || 1;
        const snapshotLen = data.snapshot ? data.snapshot.length : 0;

        // 若请求对应的页码已被翻过（目标页不等于当前激活页），坚决不启动耗时的底层 OCR
        if (targetPage !== currentStorePage) {
          console.warn(`[BubbleOCR] [ERROR_OR_CANCEL] Request page ${targetPage} does not match current store page ${currentStorePage}, dropped`);
          webViewRef.current?.postMessage('detectionFailed', {
            reason: 'page_mismatch',
            requestId: reqId,
            pageNum: targetPage,
          });
          break;
        }

        // 将当前请求标记为活跃请求，覆盖任何先前的旧请求
        activeRequestIdRef.current = reqId;
        inFlightRequestRef.current = true;
        setIsDetectingBubbles(true);
        // 新一页开始检测时，清空之前页面的残留气泡
        setDetectedBubbles([]);
        setSelectedBubble(null);

        console.log(`[BubbleOCR] [JS_RECEIPT] reqId=${reqId}, page=${targetPage}, snapshotBytes=${snapshotLen}, width=${data.width}, height=${data.height}`);

        let ackSent = false;
        detectBubblesForPage(targetPage, data.snapshot, data.width, data.height)
          .then((bubbles) => {
            const latestPage = useReaderStore.getState().currentPage;
            // 时序与页码版本严格防护：
            // 若用户在 OCR 运行期间翻页或触发了新请求，旧请求的结果坚决不覆盖当前页面
            if (activeRequestIdRef.current !== reqId || latestPage !== targetPage) {
              console.warn(`[BubbleOCR] [ERROR_OR_CANCEL] Stale request result ignored: reqId=${reqId}, currentActive=${activeRequestIdRef.current}, reqPage=${targetPage}, latestPage=${latestPage}`);
              webViewRef.current?.postMessage('detectionFailed', {
                reason: 'stale',
                requestId: reqId,
                pageNum: targetPage,
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
                pageNum: targetPage,
              });
              ackSent = true;
              triggerPageTranslation(targetPage, reqId, bubbles);
            } else {
              // 成功但结果为空（合法 0 气泡）：明确清空 overlay，发送 detectionCompleted ACK 释放 WebView 锁
              setDetectedBubbles([]);
              webViewRef.current?.postMessage('detectionCompleted', {
                bubbles: [],
                active: true,
                requestId: reqId,
                pageNum: targetPage,
              });
              ackSent = true;
            }
          })
          .catch((err) => {
            console.error(`[BubbleOCR] [ERROR_OR_CANCEL] detectBubblesForPage error (reqId=${reqId}):`, err);
            webViewRef.current?.postMessage('detectionFailed', {
              reason: err?.message || 'detection_error',
              requestId: reqId,
              pageNum: targetPage,
            });
            ackSent = true;
          })
          .finally(() => {
            // 无论任何退出路径，finally 兜底确保向 WebView 回传终态 ACK 释放对应请求锁
            if (!ackSent) {
              webViewRef.current?.postMessage('detectionFailed', {
                reason: 'finally_fallback',
                requestId: reqId,
                pageNum: targetPage,
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
          const currentBubble = useReaderStore.getState().detectedBubbles.find((bubble) => bubble.id === data.bubble.id);
          setSelectedBubble(currentBubble || data.bubble);
        }
        break;

      case 'error':
        setError(data.message || '阅读引擎内部错误');
        break;

      default:
        break;
    }
  };

  // 漫画气泡离线翻译触发与时序管理
  const triggerPageTranslation = useCallback(
    (targetPage: number, reqId: number, bubbles: TextBubble[]) => {
      translationAbortRef.current?.abort();
      retryVersionRef.current++;
      const abortController = new AbortController();
      translationAbortRef.current = abortController;

      const validBubbles = bubbles.filter((b) => !b.isPlaceholder && b.sourceText && b.sourceText.trim().length > 0);
      if (validBubbles.length === 0) return;

      const initialTranslating = bubbles.map((b) =>
        !b.isPlaceholder && b.sourceText && b.sourceText.trim().length > 0
          ? { ...b, translationStatus: 'translating' as const, translationError: undefined }
          : b
      );
      setDetectedBubbles(initialTranslating);

      const runtime = translationRuntimeRef.current || createTranslationRuntime();
      translationRuntimeRef.current = runtime;

      // 动态获取当前激活的端侧模型，避免 mixed 选定后被切回 int8
      const activeModelFile = onnxGetActiveModel();
      const deviceModel: DeviceTranslationModel = activeModelFile.includes('int4')
        ? 'device.fast-v1-mixed'
        : 'device.fast-v1-int8';

      const request: TranslationRequest = {
        requestId: `trans_${reqId}_${targetPage}_${Date.now()}`,
        bookId: currentBook?.id ? String(currentBook.id) : 'manga',
        page: targetPage,
        sourceLanguage: 'ja',
        targetLanguage: 'zh',
        route: 'device',
        deviceModel,
        bubbles: validBubbles.map((b) => ({
          id: b.id,
          sourceText: b.sourceText,
          readingOrderIndex: b.readingOrderIndex,
          textType: b.textType || 'bubble',
          direction: b.direction,
          ocrConfidence: b.confidence,
        })),
      };

      runtime
        .run(request, { signal: abortController.signal })
        .then((batchResult) => {
          const latestState = useReaderStore.getState();
          const latestPage = latestState.currentPage;
          if (
            !latestState.isOpen ||
            String(latestState.currentBook?.id ?? '') !== String(currentBook?.id ?? '') ||
            abortController.signal.aborted ||
            activeRequestIdRef.current !== reqId ||
            latestPage !== targetPage
          ) {
            return;
          }

          const transMap = new Map(batchResult.items.map((it) => [it.id, it.translatedText]));
          const updatedBubbles = useReaderStore.getState().detectedBubbles.map((b) => {
            if (transMap.has(b.id)) {
              const translated = transMap.get(b.id) || '';
              return {
                ...b,
                targetText: translated,
                translationStatus: translated ? ('translated' as const) : ('idle' as const),
                translationError: undefined,
              };
            }
            return b;
          });

          setDetectedBubbles(updatedBubbles);

          const curSelected = useReaderStore.getState().selectedBubble;
          if (curSelected && transMap.has(curSelected.id)) {
            const translated = transMap.get(curSelected.id) || '';
            setSelectedBubble({
              ...curSelected,
              targetText: translated,
              translationStatus: translated ? ('translated' as const) : ('idle' as const),
              translationError: undefined,
            });
          }

          webViewRef.current?.postMessage('setDetectedBubbles', {
            bubbles: updatedBubbles,
            active: true,
            requestId: reqId,
            pageNum: targetPage,
          });
        })
        .catch((err) => {
          const latestState = useReaderStore.getState();
          const latestPage = latestState.currentPage;
          if (
            !latestState.isOpen ||
            String(latestState.currentBook?.id ?? '') !== String(currentBook?.id ?? '') ||
            abortController.signal.aborted ||
            activeRequestIdRef.current !== reqId ||
            latestPage !== targetPage
          ) {
            return;
          }
          console.warn('[ReaderModal] 端侧离线翻译未完成:', err);
          const errorBubbles = useReaderStore.getState().detectedBubbles.map((b) => {
            if (!b.isPlaceholder && b.sourceText && b.sourceText.trim()) {
              return {
                ...b,
                translationStatus: 'error' as const,
                translationError: err?.message || '离线模型推理失败',
              };
            }
            return b;
          });
          setDetectedBubbles(errorBubbles);

          const curSelected = useReaderStore.getState().selectedBubble;
          if (curSelected && curSelected.sourceText.trim()) {
            setSelectedBubble({
              ...curSelected,
              translationStatus: 'error' as const,
              translationError: err?.message || '离线模型推理失败',
            });
          }
        });
    },
    [currentBook, setDetectedBubbles, setSelectedBubble]
  );

  const handleRetryTranslateBubble = useCallback(
    async (bubble: TextBubble) => {
      if (!bubble || bubble.isPlaceholder || !bubble.sourceText.trim() || bubble.translationStatus === 'translating') return;

      const capturedPage = useReaderStore.getState().currentPage;
      const capturedBookId = currentBook ? String(currentBook.id) : '';
      const capturedReqId = activeRequestIdRef.current;
      const capturedBubbleId = bubble.id;
      const thisRetryVersion = ++retryVersionRef.current;

      const curSelected = useReaderStore.getState().selectedBubble;
      if (curSelected?.id === capturedBubbleId) {
        setSelectedBubble({
          ...curSelected,
          translationStatus: 'translating' as const,
          translationError: undefined,
        });
      }
      setDetectedBubbles(
        useReaderStore.getState().detectedBubbles.map((b) =>
          b.id === capturedBubbleId
            ? { ...b, translationStatus: 'translating' as const, translationError: undefined }
            : b
        )
      );

      try {
        const res = await onnxTranslate(bubble.sourceText);
        if (!res.trim()) throw new Error('离线模型未生成译文，请重试');

        const storeState = useReaderStore.getState();
        const currentActiveBookId = storeState.currentBook ? String(storeState.currentBook.id) : '';
        if (
          !storeState.isOpen ||
          thisRetryVersion !== retryVersionRef.current ||
          activeRequestIdRef.current !== capturedReqId ||
          storeState.currentPage !== capturedPage ||
          currentActiveBookId !== capturedBookId
        ) {
          return;
        }

        const translatedBubble: TextBubble = {
          ...bubble,
          targetText: res,
          translationStatus: 'translated' as const,
          translationError: undefined,
        };

        if (storeState.selectedBubble?.id === capturedBubbleId) {
          setSelectedBubble(translatedBubble);
        }
        const nextBubbles = storeState.detectedBubbles.map((b) =>
          b.id === capturedBubbleId ? translatedBubble : b
        );
        setDetectedBubbles(nextBubbles);
        webViewRef.current?.postMessage('setDetectedBubbles', {
          bubbles: nextBubbles,
          active: true,
          pageNum: capturedPage,
        });
      } catch (err: any) {
        const storeState = useReaderStore.getState();
        const currentActiveBookId = storeState.currentBook ? String(storeState.currentBook.id) : '';
        if (
          !storeState.isOpen ||
          thisRetryVersion !== retryVersionRef.current ||
          activeRequestIdRef.current !== capturedReqId ||
          storeState.currentPage !== capturedPage ||
          currentActiveBookId !== capturedBookId
        ) {
          return;
        }

        const errorBubble: TextBubble = {
          ...bubble,
          translationStatus: 'error' as const,
          translationError: err?.message || '离线翻译失败',
        };

        if (storeState.selectedBubble?.id === capturedBubbleId) {
          setSelectedBubble(errorBubble);
        }
        setDetectedBubbles(
          storeState.detectedBubbles.map((b) =>
            b.id === capturedBubbleId ? errorBubble : b
          )
        );
      }
    },
    [currentBook, setDetectedBubbles, setSelectedBubble]
  );

  const cancelTranslations = useCallback(() => {
    translationAbortRef.current?.abort();
    retryVersionRef.current++;
    activeRequestIdRef.current = ++nextReqIdRef.current;
  }, []);

  useEffect(() => cancelTranslations, [isOpen, currentBook?.id, cancelTranslations]);

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
    if (!nextActive) {
      translationAbortRef.current?.abort();
      activeRequestIdRef.current = ++nextReqIdRef.current;
      inFlightRequestRef.current = false;
      setIsDetectingBubbles(false);
      setDetectedBubbles([]);
      setSelectedBubble(null);
    }
    toggleBubbleDetection(nextActive);
  };

  const handleRefreshBubbleDetect = () => {
    console.log(`[BubbleOCR] [JS_CLICK_ENTRY] handleRefreshBubbleDetect clicked, isPdf=${isPdf}`);
    if (isPdf && webViewRef.current) {
      translationAbortRef.current?.abort();
      const reqId = ++nextReqIdRef.current;
      activeRequestIdRef.current = reqId;
      inFlightRequestRef.current = false;
      setIsDetectingBubbles(true);
      setDetectedBubbles([]);
      setSelectedBubble(null);
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
          onRetryTranslate={handleRetryTranslateBubble}
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
