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
    .bubble-box {
      position: absolute;
      box-sizing: border-box;
      border-radius: 8px;
      pointer-events: auto;
      cursor: pointer;
      transition: transform 0.15s ease, background-color 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: flex-start;
    }
    .bubble-box:active {
      transform: scale(0.96);
    }
    /* 对话气泡 (蓝色光晕) */
    .bubble-type-bubble {
      border: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.16);
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    /* 拟声动效词 (玫红虚线框) */
    .bubble-type-sfx {
      border: 2px dashed #f43f5e;
      background: rgba(244, 63, 94, 0.16);
      box-shadow: 0 0 8px rgba(244, 63, 94, 0.35);
    }
    /* 画面大标题 (金橙加粗框) */
    .bubble-type-title {
      border: 2.5px solid #ea580c;
      background: rgba(234, 88, 12, 0.18);
      box-shadow: 0 0 12px rgba(234, 88, 12, 0.45);
    }
    /* 旁白/嵌字 (紫色精细框) */
    .bubble-type-free_text {
      border: 2px solid #8b5cf6;
      background: rgba(139, 92, 246, 0.16);
      box-shadow: 0 0 8px rgba(139, 92, 246, 0.35);
    }
    .bubble-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #0284c7;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 6px;
      margin: 2px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      line-height: 14px;
    }
    .bubble-type-sfx .bubble-badge {
      background: #e11d48;
    }
    .bubble-type-title .bubble-badge {
      background: #ea580c;
    }
    .bubble-type-free_text .bubble-badge {
      background: #7c3aed;
    }
    .bubble-tag {
      font-size: 10px;
      font-weight: 600;
      color: #ffffff;
      opacity: 0.9;
      margin-left: 2px;
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

      function renderCurrentPage() {
        if (!pdfDoc || isRendering) return;
        isRendering = true;

        var container = document.getElementById('viewer-container');
        container.innerHTML = '';

        pdfDoc.getPage(currentPageNum).then(function(page) {
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

          page.render(renderContext).promise.then(function() {
            isRendering = false;

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
            isRendering = false;
          });
        }).catch(function(err) {
          isRendering = false;
          sendToParent({ type: 'error', message: '渲染页面失败: ' + err.message });
        });
      }

      function requestDetection(canvasEl) {
        var cv = canvasEl || document.querySelector('canvas');
        if (!cv) return;
        try {
          var snapshot = cv.toDataURL('image/jpeg', 0.90);
          sendToParent({
            type: 'requestBubbleDetection',
            pageNum: currentPageNum,
            snapshot: snapshot,
            width: cv.width,
            height: cv.height
          });
        } catch (e) {
          sendToParent({
            type: 'requestBubbleDetection',
            pageNum: currentPageNum,
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

        bubbles.forEach(function(b, idx) {
          var box = b.box;
          if (!box) return;

          var el = document.createElement('div');
          var typeClass = 'bubble-type-' + (b.textType || 'bubble');
          el.className = 'bubble-box ' + typeClass;

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

          el.style.left = Math.max(0, Math.min(100, leftPct)) + '%';
          el.style.top = Math.max(0, Math.min(100, topPct)) + '%';
          el.style.width = Math.max(0, Math.min(100, widthPct)) + '%';
          el.style.height = Math.max(0, Math.min(100, heightPct)) + '%';

          var badge = document.createElement('span');
          badge.className = 'bubble-badge';
          var orderText = '#' + (b.readingOrderIndex || (idx + 1));
          var labelText = b.textType === 'title' ? ' 标题' : (b.textType === 'sfx' ? ' 拟声' : '');
          badge.innerText = orderText + labelText;
          el.appendChild(badge);

          el.addEventListener('click', function(e) {
            e.stopPropagation();
            sendToParent({
              type: 'bubblePressed',
              bubble: b
            });
          });

          overlay.appendChild(el);
        });
      }

      // Tap listener for pagination & menu toggle
      document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.bubble-box')) {
          return; // 拦截气泡内点击，防止误触发翻页或菜单
        }
        var width = window.innerWidth || document.documentElement.clientWidth;
        var x = e.clientX;
        if (x < width * 0.28) {
          if (currentPageNum > 1) {
            currentPageNum--;
            renderCurrentPage();
          }
        } else if (x > width * 0.72) {
          if (currentPageNum < totalPages) {
            currentPageNum++;
            renderCurrentPage();
          }
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

              renderCurrentPage();
            }).catch(function(err) {
              sendToParent({ type: 'error', message: 'PDF 解析失败: ' + (err.message || String(err)) });
            });
          } catch (e) {
            sendToParent({ type: 'error', message: e.message || String(e) });
          }
        },

        nextPage: function() {
          if (currentPageNum < totalPages) {
            currentPageNum++;
            renderCurrentPage();
          }
        },

        prevPage: function() {
          if (currentPageNum > 1) {
            currentPageNum--;
            renderCurrentPage();
          }
        },

        goToPage: function(num) {
          if (num >= 1 && num <= totalPages) {
            currentPageNum = num;
            renderCurrentPage();
          }
        },

        goToProgress: function(pct) {
          if (totalPages > 0) {
            var target = Math.max(1, Math.min(totalPages, Math.round((pct / 100) * totalPages)));
            currentPageNum = target;
            renderCurrentPage();
          }
        },

        applySettings: function(settings) {
          if (settings && settings.theme && themeBackgrounds[settings.theme]) {
            document.body.style.backgroundColor = themeBackgrounds[settings.theme];
          }
        }
      };

      window.addEventListener('message', function(event) {
        try {
          var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
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
          } else if (data.action === 'setDetectedBubbles') {
            currentBubbles = data.bubbles || [];
            isBubbleDetectionActive = Boolean(data.active !== undefined ? data.active : true);
            renderBubbleOverlay(currentBubbles, isBubbleDetectionActive);
          } else if (data.action === 'toggleBubbleDetection') {
            isBubbleDetectionActive = Boolean(data.active);
            if (isBubbleDetectionActive) {
              if (currentBubbles && currentBubbles.length > 0) {
                renderBubbleOverlay(currentBubbles, true);
              } else {
                requestDetection();
              }
            } else {
              renderBubbleOverlay([], false);
            }
          } else if (data.action === 'runBubbleDetection') {
            isBubbleDetectionActive = true;
            requestDetection();
          }
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
