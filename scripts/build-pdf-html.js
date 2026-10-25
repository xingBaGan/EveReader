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
    #page-indicator {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      padding: 5px 14px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(8px);
      pointer-events: none;
      z-index: 40;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
  </style>
  <script>
${pdfJsCode}
  </script>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div id="loading-text">正在解析 PDF 漫画与图书...</div>
  </div>

  <div id="viewer-container"></div>
  <div id="page-indicator">...</div>

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
      var currentTheme = 'dark';

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

      function updatePageIndicator() {
        var ind = document.getElementById('page-indicator');
        if (ind && totalPages > 0) {
          ind.innerText = currentPageNum + ' / ' + totalPages;
        }
      }

      function renderCurrentPage() {
        if (!pdfDoc || isRendering) return;
        isRendering = true;

        var container = document.getElementById('viewer-container');
        container.innerHTML = '';

        pdfDoc.getPage(currentPageNum).then(function(page) {
          var containerWidth = window.innerWidth || document.documentElement.clientWidth || 360;
          var containerHeight = window.innerHeight || document.documentElement.clientHeight || 640;
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
          container.appendChild(wrapper);

          var ctx = canvas.getContext('2d');
          var renderContext = {
            canvasContext: ctx,
            viewport: viewport
          };

          page.render(renderContext).promise.then(function() {
            isRendering = false;
            updatePageIndicator();

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
          }).catch(function(err) {
            isRendering = false;
          });
        }).catch(function(err) {
          isRendering = false;
          sendToParent({ type: 'error', message: '渲染页面失败: ' + err.message });
        });
      }

      // Tap listener for pagination & menu toggle
      document.addEventListener('click', function(e) {
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
        initPdf: function(base64Data, initialPage, theme) {
          try {
            if (theme && themeBackgrounds[theme]) {
              document.body.style.backgroundColor = themeBackgrounds[theme];
            }

            document.getElementById('loading-text').innerText = '正在载入 PDF 内容...';
            var binary = atob(base64Data);
            var len = binary.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
              bytes[i] = binary.charCodeAt(i);
            }

            pdfjsLib.getDocument({ data: bytes }).promise.then(function(doc) {
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
              sendToParent({ type: 'error', message: 'PDF 解析失败: ' + err.message });
            });
          } catch (e) {
            sendToParent({ type: 'error', message: e.message });
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
          if (data.action === 'initPdf') {
            window.PdfReaderApi.initPdf(data.base64Data, data.initialPage, data.theme);
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
          }
        } catch (e) {}
      });

      // Send ready signal with heartbeat until initialized
      var readyInterval = setInterval(function() {
        if (pdfDoc) {
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
