const fs = require('fs');
const path = require('path');

const pdfJsPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.min.js');
const pdfWorkerJsPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js');

const pdfJsCode = fs.readFileSync(pdfJsPath, 'utf8');
const pdfWorkerJsCode = fs.readFileSync(pdfWorkerJsPath, 'utf8');

// Escape worker code for inlining
const escapedWorkerCode = JSON.stringify(pdfWorkerJsCode);

const clientHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow-x: hidden;
      overflow-y: auto;
      background-color: #18191a;
      color: #cbd5e1;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
    }
    #loading {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #18191a;
      color: #94a3b8;
      font-size: 14px;
      gap: 14px;
      z-index: 100;
      transition: opacity 0.3s ease;
    }
    .spinner {
      width: 38px;
      height: 38px;
      border: 3px solid rgba(148, 163, 184, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #viewer-container {
      width: 100%;
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px 0 60px;
    }
    .page-canvas-wrapper {
      position: relative;
      margin: 8px auto;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
      border-radius: 4px;
      overflow: hidden;
      background: #ffffff;
    }
    canvas {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .bubble-overlay-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }
    .translation-overlay-box {
      position: absolute;
      box-sizing: border-box;
      background: #fff;
      color: #0f172a;
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
      padding: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow: hidden;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      -webkit-user-select: none;
      transition: transform 0.12s ease, background-color 0.15s ease;
    }
    .translation-overlay-box:active {
      transform: scale(0.97);
      background: #f1f5f9;
    }
    .translation-text-content {
      display: block;
      width: 100%;
      overflow-wrap: anywhere;
      line-height: 1.25;
      font-weight: 500;
      color: #0f172a;
      letter-spacing: 0;
    }
    .translation-mini-pill {
      position: absolute;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.96);
      color: #0284c7;
      border: 1px solid rgba(2, 132, 199, 0.45);
      border-radius: 10px;
      min-width: 28px;
      min-height: 28px;
      padding: 2px 5px;
      font-size: 10px;
      font-weight: 700;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      -webkit-user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      transition: transform 0.12s ease;
    }
    .translation-mini-pill:active {
      transform: scale(0.92);
      background: #f0f9ff;
    }
  </style>
  <script>
${pdfJsCode}
  </script>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div id="loading-text">正在准备解析 PDF...</div>
  </div>

  <div id="viewer-container"></div>

  <script>
    (function() {
      // Initialize Inline PDF Worker
      try {
        var workerCode = ${escapedWorkerCode};
        var blob = new Blob([workerCode], { type: 'application/javascript' });
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      } catch (e) {
        console.warn('Worker init fallback:', e);
      }

      var pdfDoc = null;
      var currentPageNum = 1;
      var totalPages = 0;
      var isRendering = false;
      var assembledChunks = null;
      var totalExpectedBytes = 0;
      var bytesReceived = 0;
      var currentBubbles = [];
      var isBubbleDetectionActive = false;

      var themeBackgrounds = {
        light: '#f1f5f9',
        sepia: '#ede5d4',
        mint: '#d3e4d0',
        dark: '#18191a',
        black: '#000000'
      };

      function sendToParent(msg) {
        var str = JSON.stringify(msg);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(str);
        } else if (window.parent && window.parent !== window) {
          window.parent.postMessage(str, '*');
        }
      }

      var isSnapshotInFlight = false;
      var activeDetectionReqId = 0;
      var currentRenderTask = null;
      var pendingPageNum = null;

      function abortInFlightDetection() {
        activeDetectionReqId++;
        isSnapshotInFlight = false;
        currentBubbles = [];
        renderBubbleOverlay([], false);
        sendToParent({
          type: 'cancelBubbleDetection',
          pageNum: currentPageNum,
          activeReqId: activeDetectionReqId
        });
      }

      function goToPageInternal(targetPage) {
        if (!pdfDoc) return;
        var clamped = Math.max(1, Math.min(totalPages, targetPage));
        if (clamped === currentPageNum && !isRendering && document.querySelector('canvas')) {
          return;
        }

        // 无论当前是否正在渲染，连续点击翻页时坚决中止旧页面的气泡识别、清空图层并通知 Native
        abortInFlightDetection();

        if (isRendering) {
          pendingPageNum = clamped;
          if (currentRenderTask) {
            try { currentRenderTask.cancel(); } catch (e) {}
          }
          return;
        }

        currentPageNum = clamped;
        renderCurrentPage();
      }

      function renderCurrentPage() {
        if (!pdfDoc) return;
        isRendering = true;
        var renderPageNum = currentPageNum;

        var container = document.getElementById('viewer-container');
        container.innerHTML = '';

        pdfDoc.getPage(renderPageNum).then(function(page) {
          if (pendingPageNum !== null && pendingPageNum !== renderPageNum) {
            isRendering = false;
            var next = pendingPageNum;
            pendingPageNum = null;
            goToPageInternal(next);
            return;
          }

          var containerWidth = window.innerWidth || document.documentElement.clientWidth || 360;
          var unscaledViewport = page.getViewport({ scale: 1.0 });

          // Scale to fit screen width snugly
          var scale = (containerWidth - 16) / unscaledViewport.width;
          var dpr = Math.min(window.devicePixelRatio || 1.5, 2.5);
          var viewport = page.getViewport({ scale: scale * dpr });

          var wrapper = document.createElement('div');
          wrapper.className = 'page-canvas-wrapper';
          wrapper.style.width = Math.floor(viewport.width / dpr) + 'px';
          wrapper.style.height = Math.floor(viewport.height / dpr) + 'px';

          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = '100%';

          wrapper.appendChild(canvas);

          var overlay = document.createElement('div');
          overlay.className = 'bubble-overlay-layer';
          overlay.id = 'bubble-overlay';
          wrapper.appendChild(overlay);

          container.appendChild(wrapper);

          var ctx = canvas.getContext('2d');
          var renderContext = {
            canvasContext: ctx,
            viewport: viewport
          };

          currentRenderTask = page.render(renderContext);
          currentRenderTask.promise.then(function() {
            currentRenderTask = null;
            isRendering = false;

            if (pendingPageNum !== null) {
              var next = pendingPageNum;
              pendingPageNum = null;
              goToPageInternal(next);
              return;
            }

            var progress = (currentPageNum / totalPages) * 100;
            sendToParent({
              type: 'relocated',
              progress: Math.min(100, Math.max(0, progress)),
              currentPage: currentPageNum,
              totalPages: totalPages,
              chapterTitle: '第 ' + currentPageNum + ' / ' + totalPages + ' 页'
            });

            var loader = document.getElementById('loading');
            if (loader) {
              loader.style.opacity = '0';
              setTimeout(function() { loader.style.display = 'none'; }, 200);
            }

            // 翻页后如果气泡检测处于开启状态，立即请求原生深度学习检测器 (RT-DETR-v2 + ML Kit)
            if (isBubbleDetectionActive) {
              requestDetection(canvas);
            }
          }).catch(function(err) {
            currentRenderTask = null;
            isRendering = false;
            if (err && (err.name === 'RenderingCancelledException' || String(err).indexOf('RenderingCancelledException') !== -1)) {
              if (pendingPageNum !== null) {
                var next = pendingPageNum;
                pendingPageNum = null;
                goToPageInternal(next);
              }
              return;
            }
            console.warn('page.render failed:', err);
          });
        }).catch(function(err) {
          isRendering = false;
          sendToParent({ type: 'error', message: '渲染页面失败: ' + err.message });
        });
      }

      function requestDetection(canvasEl, incomingReqId) {
        var cv = canvasEl || document.querySelector('canvas');
        if (!cv) {
          console.warn('[BubbleOCR] [SNAPSHOT_FAILED] Canvas not found on page ' + currentPageNum);
          return;
        }
        var reqId = incomingReqId || (++activeDetectionReqId);
        activeDetectionReqId = reqId;
        isSnapshotInFlight = true;
        var capturePageNum = currentPageNum;

        var t0 = Date.now();
        console.log('[BubbleOCR] [SNAPSHOT_START] reqId=' + reqId + ', page=' + capturePageNum + ', size=' + cv.width + 'x' + cv.height);
        try {
          var snapshot = cv.toDataURL('image/jpeg', 0.90);
          if (currentPageNum !== capturePageNum || activeDetectionReqId !== reqId) {
            console.warn('[BubbleOCR] [SNAPSHOT_DROPPED] Page switched during snapshot, reqId=' + reqId);
            return;
          }
          console.log('[BubbleOCR] [SNAPSHOT_COMPLETE] reqId=' + reqId + ', bytes=' + snapshot.length + ' in ' + (Date.now() - t0) + 'ms');
          sendToParent({
            type: 'requestBubbleDetection',
            requestId: reqId,
            pageNum: capturePageNum,
            snapshot: snapshot,
            width: cv.width,
            height: cv.height
          });
        } catch (e) {
          isSnapshotInFlight = false;
          console.error('[BubbleOCR] [SNAPSHOT_ERROR] ' + e.message);
          sendToParent({
            type: 'requestBubbleDetection',
            requestId: reqId,
            pageNum: capturePageNum,
            width: cv.width,
            height: cv.height
          });
        }
      }

      function renderBubbleOverlay(bubbles, visible) {
        var overlay = document.getElementById('bubble-overlay');
        if (!overlay) return;
        overlay.innerHTML = '';
        if (!visible || !bubbles || bubbles.length === 0) return;

        var cv = document.querySelector('canvas');
        var cvW = cv ? cv.width : 600;
        var cvH = cv ? cv.height : 800;
        var wrapperW = overlay.clientWidth || (cv ? Math.floor(cv.width / (window.devicePixelRatio || 1)) : 360);
        var wrapperH = overlay.clientHeight || (cv ? Math.floor(cv.height / (window.devicePixelRatio || 1)) : 500);

        bubbles.forEach(function(b) {
          var box = b.box;
          if (!box) return;

          var targetText = (b.targetText || '').trim();
          // 加载期间保留原图；未识别/失败或未就绪时不画假译文覆盖层
          if (!targetText) {
            return;
          }

          var leftPct, topPct, widthPct, heightPct;

          if (box.x <= 1.0 && box.y <= 1.0 && box.width <= 1.0 && box.height <= 1.0) {
            // 归一化比例 (0.0 ~ 1.0)
            leftPct = box.x * 100;
            topPct = box.y * 100;
            widthPct = box.width * 100;
            heightPct = box.height * 100;
          } else if (box.x <= 100.0 && box.y <= 100.0 && box.width <= 100.0 && box.height <= 100.0) {
            // 已是百分比坐标 (0.0% ~ 100.0%)
            leftPct = box.x;
            topPct = box.y;
            widthPct = box.width;
            heightPct = box.height;
          } else {
            // 绝对像素坐标 (> 100)
            var refW = b.refWidth || cvW || 600;
            var refH = b.refHeight || cvH || 800;
            leftPct = (box.x / refW) * 100;
            topPct = (box.y / refH) * 100;
            widthPct = (box.width / refW) * 100;
            heightPct = (box.height / refH) * 100;
          }

          var left = Math.max(0, Math.min(100, leftPct));
          var top = Math.max(0, Math.min(100, topPct));
          var width = Math.max(0, Math.min(100 - left, widthPct));
          var height = Math.max(0, Math.min(100 - top, heightPct));

          var boxPixelW = (width / 100) * wrapperW;
          var boxPixelH = (height / 100) * wrapperH;

          // 过小区域（宽度或高度过小，无法容纳文字且容易遮挡小画面）使用轻量胶囊入口
          var isMiniEntry = (boxPixelW < 14 || boxPixelH < 18 || (boxPixelW * boxPixelH < 200));

          var el = document.createElement('div');
          el.setAttribute('role', 'button');
          el.setAttribute('tabindex', '0');
          el.setAttribute('aria-label', '查看译文和原文：' + targetText);
          if (isMiniEntry) {
            el.className = 'translation-mini-pill';
            el.style.left = left + '%';
            el.style.top = top + '%';
            el.innerText = '译';
          } else {
            el.className = 'translation-overlay-box';
            el.style.left = left + '%';
            el.style.top = top + '%';
            el.style.width = width + '%';
            el.style.height = height + '%';

            var span = document.createElement('span');
            span.className = 'translation-text-content';
            span.textContent = targetText;
            if (b.direction === 'vertical' && boxPixelH > boxPixelW * 1.6) {
              span.style.writingMode = 'vertical-rl';
              span.style.textOrientation = 'upright';
              span.style.width = 'auto';
              span.style.height = '100%';
              span.style.lineHeight = '1.15';
              el.style.padding = '0';
            }
            el.appendChild(span);
          }

          function showTranslation(e) {
            e.stopPropagation();
            e.preventDefault();
            sendToParent({
              type: 'bubblePressed',
              bubble: b
            });
          }
          el.addEventListener('click', showTranslation);
          el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') showTranslation(e);
          });

          overlay.appendChild(el);
          if (!isMiniEntry) {
            // Measure real wrapping after insertion; area estimates alone can clip narrow columns.
            var fits = false;
            var inset = el.style.padding === '0px' || el.style.padding === '0' ? 0 : 4;
            for (var size = 16; size >= 11; size -= 0.5) {
              span.style.fontSize = size + 'px';
              if (span.scrollHeight <= el.clientHeight - inset && span.scrollWidth <= el.clientWidth - inset) {
                fits = true;
                break;
              }
            }
            if (!fits) {
              el.className = 'translation-mini-pill';
              el.style.width = '';
              el.style.height = '';
              el.textContent = '译';
            }
          }
        });
      }

      // Tap listener for pagination & menu toggle
      document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && (e.target.closest('.translation-overlay-box') || e.target.closest('.translation-mini-pill'))) {
          return; // 拦截气泡内点击，防止误触发翻页或菜单
        }
        var width = window.innerWidth || document.documentElement.clientWidth;
        var x = e.clientX;
        if (x < width * 0.28) {
          goToPageInternal(currentPageNum - 1);
        } else if (x > width * 0.72) {
          goToPageInternal(currentPageNum + 1);
        } else {
          sendToParent({ type: 'toggleBars' });
        }
      });

      window.PdfReaderApi = {
        loadFromUint8Array: function(bytes, initialPage, theme) {
          try {
            if (theme && themeBackgrounds[theme]) {
              document.body.style.backgroundColor = themeBackgrounds[theme];
            }
            document.getElementById('loading-text').innerText = '正在排版页面...';

            pdfjsLib.getDocument({
              data: bytes,
              cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
              cMapPacked: true
            }).promise.then(function(doc) {
              pdfDoc = doc;
              totalPages = doc.numPages;
              currentPageNum = Math.min(totalPages, Math.max(1, initialPage || 1));

              sendToParent({
                type: 'pdfLoaded',
                totalPages: totalPages
              });

              // Extract Page 1 as high-resolution cover
              doc.getPage(1).then(function(page1) {
                var viewport = page1.getViewport({ scale: 0.8 });
                var canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                var ctx = canvas.getContext('2d');
                page1.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                  try {
                    var coverDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    sendToParent({
                      type: 'coverExtracted',
                      cover: coverDataUrl,
                      totalPages: totalPages
                    });
                  } catch (e) {}
                });
              });

              // Extract Outline/Bookmarks if available
              try {
                doc.getOutline().then(function(outline) {
                  if (outline && outline.length > 0) {
                    function resolveOutlineItem(item) {
                      return new Promise(function(resolve) {
                        var title = (item.title || '章节').trim();
                        if (!item.dest) {
                          resolve({ id: 'outline_' + Math.random(), label: title, href: '1' });
                          return;
                        }
                        var pDest = typeof item.dest === 'string'
                          ? doc.getDestination(item.dest)
                          : Promise.resolve(item.dest);
                        pDest.then(function(explicitDest) {
                          if (!explicitDest || !explicitDest[0]) {
                            resolve({ id: 'outline_' + Math.random(), label: title, href: '1' });
                            return;
                          }
                          doc.getPageIndex(explicitDest[0]).then(function(idx) {
                            var pNum = idx + 1;
                            resolve({
                              id: 'outline_p' + pNum + '_' + Math.random(),
                              label: title,
                              href: String(pNum)
                            });
                          }).catch(function() {
                            resolve({ id: 'outline_' + Math.random(), label: title, href: '1' });
                          });
                        }).catch(function() {
                          resolve({ id: 'outline_' + Math.random(), label: title, href: '1' });
                        });
                      });
                    }
                    Promise.all(outline.map(resolveOutlineItem)).then(function(tocList) {
                      if (tocList && tocList.length > 0) {
                        sendToParent({
                          type: 'tocLoaded',
                          toc: tocList
                        });
                      }
                    });
                  }
                }).catch(function() {});
              } catch(e) {}

              renderCurrentPage();
            }).catch(function(err) {
              sendToParent({ type: 'error', message: 'PDF 解析失败: ' + (err.message || String(err)) });
            });
          } catch (e) {
            sendToParent({ type: 'error', message: e.message || String(e) });
          }
        },

        nextPage: function() {
          goToPageInternal(currentPageNum + 1);
        },

        prevPage: function() {
          goToPageInternal(currentPageNum - 1);
        },

        goToPage: function(num) {
          goToPageInternal(num);
        },

        goToProgress: function(pct) {
          if (totalPages > 0) {
            var target = Math.max(1, Math.min(totalPages, Math.round((pct / 100) * totalPages)));
            goToPageInternal(target);
          }
        },

        applySettings: function(settings) {
          if (settings && settings.theme && themeBackgrounds[settings.theme]) {
            document.body.style.backgroundColor = themeBackgrounds[settings.theme];
          }
        }
      };

      function handleIncomingAction(data) {
        if (!data || !data.action) return;

        if (data.action === 'initPdfStream') {
          totalExpectedBytes = data.totalBytes;
          assembledChunks = new Uint8Array(data.totalBytes);
          bytesReceived = 0;
          document.getElementById('loading-text').innerText = '正在载入内容 (0%)...';
        } else if (data.action === 'appendPdfChunk') {
          var binary = atob(data.chunkData);
          var len = binary.length;
          for (var i = 0; i < len; i++) {
            assembledChunks[bytesReceived + i] = binary.charCodeAt(i);
          }
          bytesReceived += len;
          var pct = Math.min(100, Math.round((bytesReceived / totalExpectedBytes) * 100));
          document.getElementById('loading-text').innerText = '正在载入内容 (' + pct + '%)...';

          if (data.isLastChunk) {
            document.getElementById('loading-text').innerText = '正在解析文档与漫画...';
            window.PdfReaderApi.loadFromUint8Array(assembledChunks, data.initialPage, data.theme);
          }
        } else if (data.action === 'nextPage') {
          window.PdfReaderApi.nextPage();
        } else if (data.action === 'prevPage') {
          window.PdfReaderApi.prevPage();
        } else if (data.action === 'goToPage') {
          window.PdfReaderApi.goToPage(data.pageNum);
        } else if (data.action === 'goToProgress') {
          window.PdfReaderApi.goToProgress(data.progress);
        } else if (data.action === 'applySettings') {
          window.PdfReaderApi.applySettings(data.settings);
        } else if (data.action === 'setDetectedBubbles' || data.action === 'detectionCompleted') {
          if (!isBubbleDetectionActive) return;
          // 时序与版本保护：只有匹配当前 activeDetectionReqId 且匹配当前页码的 ACK 才能释放锁并更新 overlay
          // 旧 request 或旧页面的迟到 ACK 严禁污染当前页面！
          if (data.requestId && activeDetectionReqId && data.requestId !== activeDetectionReqId) {
            console.warn('[BubbleOCR] [STALE_ACK_DROPPED] reqId=' + data.requestId + ' does not match activeReqId=' + activeDetectionReqId);
            return;
          }
          if (data.pageNum && data.pageNum !== currentPageNum) {
            console.warn('[BubbleOCR] [STALE_PAGE_DROPPED] pageNum=' + data.pageNum + ' does not match currentPageNum=' + currentPageNum);
            return;
          }
          isSnapshotInFlight = false;
          currentBubbles = data.bubbles || [];
          // 明确清空/更新 overlay，0 结果时清空旧定位框，绝不沉默残留！
          renderBubbleOverlay(currentBubbles, isBubbleDetectionActive);
        } else if (data.action === 'detectionFailed') {
          // 异常、stale 或兜底失败 ACK：释放对应 request 的锁
          if (data.requestId && activeDetectionReqId && data.requestId !== activeDetectionReqId) {
            console.warn('[BubbleOCR] [STALE_ACK_DROPPED] detectionFailed reqId=' + data.requestId + ' does not match activeReqId=' + activeDetectionReqId);
            return;
          }
          isSnapshotInFlight = false;
          console.warn('[BubbleOCR] [ACK_FAILED] detectionFailed received for reqId=' + data.requestId + ', reason=' + (data.reason || 'unknown'));
        } else if (data.action === 'toggleBubbleDetection') {
          isBubbleDetectionActive = Boolean(data.active);
          if (isBubbleDetectionActive) {
            requestDetection(null, data.requestId);
          } else {
            // 关闭检测终态：释放锁并清空 overlay
            abortInFlightDetection();
          }
        } else if (data.action === 'runBubbleDetection') {
          isBubbleDetectionActive = true;
          isSnapshotInFlight = false;
          requestDetection(null, data.requestId);
        }
      }

      var lastMessageTime = 0;
      var lastMessageFingerprint = '';

      // 仅对“气泡检测开关”类动作做重复投递防抖；
      // appendPdfChunk / initPdfStream / 翻页等动作是高频数据流，绝对不能去重！
      var dedupActions = {
        toggleBubbleDetection: 1,
        runBubbleDetection: 1
      };

      function dispatchActionSafely(data) {
        if (!data || !data.action) return;
        if (dedupActions[data.action] === 1) {
          var fp = data.action + '_' + (data.active !== undefined ? data.active : '') + '_' + (data.requestId || '');
          var now = Date.now();
          // 幂等防抖保护：80ms 内相同 action 的重复消息直接过滤
          if (fp === lastMessageFingerprint && (now - lastMessageTime) < 80) {
            return;
          }
          lastMessageFingerprint = fp;
          lastMessageTime = now;
        }
        handleIncomingAction(data);
      }

      // 单一主注入函数，优先由 React Native 直接调用
      window.receiveMessageFromNative = function(msg) {
        try {
          var data = typeof msg === 'string' ? JSON.parse(msg) : msg;
          dispatchActionSafely(data);
        } catch(e) {}
      };

      // 单一 fallback 事件监听器
      window.addEventListener('message', function(event) {
        try {
          var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          dispatchActionSafely(data);
        } catch (e) {}
      });

      // Send ready signal with heartbeat until initialized
      var readyInterval = setInterval(function() {
        if (pdfDoc || bytesReceived > 0) {
          clearInterval(readyInterval);
        } else {
          sendToParent({ type: 'pdfReaderReady' });
        }
      }, 250);
    })();
  </script>
</body>
</html>`;

const outTsPath = path.join(__dirname, '../src/components/reader/pdfTemplate.ts');
const tsContent = `// Auto-generated by scripts/build-pdf-html.js. DO NOT EDIT DIRECTLY.
export const PDF_BUNDLE_HTML = ${JSON.stringify(clientHtml)};
`;

fs.mkdirSync(path.dirname(outTsPath), { recursive: true });
fs.writeFileSync(outTsPath, tsContent, 'utf8');
console.log('Successfully generated', outTsPath, 'size:', tsContent.length);
