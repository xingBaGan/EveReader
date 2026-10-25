const fs = require('fs');
const path = require('path');

const jszipPath = path.join(__dirname, '../node_modules/jszip/dist/jszip.min.js');
const epubjsPath = path.join(__dirname, '../node_modules/epubjs/dist/epub.min.js');

const jszipCode = fs.readFileSync(jszipPath, 'utf8');
const epubjsCode = fs.readFileSync(epubjsPath, 'utf8');

const clientHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
      overflow: hidden;
      background-color: #ffffff;
      color: #1a1a1a;
      user-select: none;
      -webkit-user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    #viewer {
      width: 100%;
      height: 100%;
    }
    #loading {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: inherit;
      color: #64748b;
      font-size: 14px;
      gap: 14px;
      z-index: 100;
      transition: opacity 0.3s ease;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(100, 116, 139, 0.2);
      border-top-color: #0284c7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #search-highlight-style {
      display: none;
    }
  </style>
  <script>
${jszipCode}
  </script>
  <script>
${epubjsCode}
  </script>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div id="loading-text">正在准备阅读器...</div>
  </div>
  <div id="viewer"></div>

  <script>
    (function() {
      var book = null;
      var rendition = null;
      var currentSettings = {
        fontSize: 18,
        lineHeight: 1.6,
        theme: 'light',
        flow: 'paginated',
        fontFamily: 'system'
      };

      var themeColors = {
        light: { bg: '#ffffff', text: '#1e293b' },
        sepia: { bg: '#f6f1e7', text: '#382c1e' },
        mint: { bg: '#e2ede0', text: '#1d3319' },
        dark: { bg: '#18191a', text: '#cbd5e1' },
        black: { bg: '#000000', text: '#94a3b8' }
      };

      function sendToParent(msg) {
        var str = JSON.stringify(msg);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(str);
        } else if (window.parent && window.parent !== window) {
          window.parent.postMessage(str, '*');
        }
      }

      function updateTheme(settings) {
        if (!rendition) return;
        var theme = themeColors[settings.theme] || themeColors.light;
        document.body.style.backgroundColor = theme.bg;
        document.body.style.color = theme.text;
        
        var fontFamilyVal = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif';
        if (settings.fontFamily === 'serif') {
          fontFamilyVal = '"Songti SC", "SimSun", "STSong", serif';
        } else if (settings.fontFamily === 'kaiti') {
          fontFamilyVal = '"Kaiti SC", "KaiTi", "STKaiti", serif';
        }

        rendition.themes.default({
          'body': {
            'background': theme.bg + ' !important',
            'color': theme.text + ' !important',
            'font-family': fontFamilyVal + ' !important',
            'font-size': settings.fontSize + 'px !important',
            'line-height': settings.lineHeight + ' !important',
            'padding': (settings.flow === 'scrolled' ? '12px 18px 48px' : '0 16px') + ' !important',
            'margin': '0 !important'
          },
          'p': {
            'font-size': settings.fontSize + 'px !important',
            'line-height': settings.lineHeight + ' !important',
            'margin-bottom': '1em !important',
            'text-align': 'justify !important'
          },
          'h1, h2, h3, h4, h5, h6': {
            'color': theme.text + ' !important',
            'font-family': fontFamilyVal + ' !important'
          },
          'a': {
            'color': '#0284c7 !important'
          }
        });
      }

      window.ReaderApi = {
        initBook: function(base64Data, initialCfi, settings) {
          try {
            if (settings) {
              currentSettings = Object.assign({}, currentSettings, settings);
            }
            var initialTheme = themeColors[currentSettings.theme] || themeColors.light;
            document.body.style.backgroundColor = initialTheme.bg;
            document.getElementById('loading-text').innerText = '正在解析电子书结构...';

            var binary = atob(base64Data);
            var len = binary.length;
            var buffer = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
              buffer[i] = binary.charCodeAt(i);
            }

            book = ePub(buffer.buffer);

            rendition = book.renderTo('viewer', {
              width: '100%',
              height: '100%',
              spread: 'none',
              flow: currentSettings.flow === 'scrolled' ? 'scrolled-doc' : 'paginated',
              allowScriptedContent: true
            });

            updateTheme(currentSettings);

            // Register tap and navigation hooks
            rendition.hooks.content.register(function(contents) {
              var doc = contents.document;
              doc.addEventListener('click', function(e) {
                var width = doc.documentElement.clientWidth;
                var x = e.clientX;
                if (x < width * 0.28) {
                  if (currentSettings.flow === 'paginated') {
                    rendition.prev();
                  } else {
                    sendToParent({ type: 'toggleBars' });
                  }
                } else if (x > width * 0.72) {
                  if (currentSettings.flow === 'paginated') {
                    rendition.next();
                  } else {
                    sendToParent({ type: 'toggleBars' });
                  }
                } else {
                  sendToParent({ type: 'toggleBars' });
                }
              });
            });

            rendition.display(initialCfi || undefined).then(function() {
              var loader = document.getElementById('loading');
              if (loader) {
                loader.style.opacity = '0';
                setTimeout(function() { loader.style.display = 'none'; }, 300);
              }
              sendToParent({ type: 'bookOpened' });
            }).catch(function(err) {
              sendToParent({ type: 'error', message: '渲染失败: ' + err.message });
            });

            // TOC
            book.loaded.navigation.then(function(nav) {
              sendToParent({
                type: 'tocLoaded',
                toc: nav.toc || []
              });
            });

            // Location change
            rendition.on('relocated', function(location) {
              var cfi = location.start.cfi;
              var progress = 0;
              if (book.locations && book.locations.length() > 0) {
                progress = book.locations.percentageFromCfi(cfi) * 100;
              }
              sendToParent({
                type: 'relocated',
                cfi: cfi,
                progress: Math.min(100, Math.max(0, progress)),
                atStart: location.atStart,
                atEnd: location.atEnd
              });
            });

            // Locations generation
            book.ready.then(function() {
              return book.locations.generate(1000);
            }).then(function(locs) {
              sendToParent({
                type: 'locationsReady',
                totalLocations: locs.length
              });
            });

          } catch (e) {
            sendToParent({ type: 'error', message: e.message });
          }
        },

        prevPage: function() {
          if (rendition) rendition.prev();
        },

        nextPage: function() {
          if (rendition) rendition.next();
        },

        goToCfi: function(cfi) {
          if (rendition) rendition.display(cfi);
        },

        goToProgress: function(pct) {
          if (book && book.locations && rendition) {
            var cfi = book.locations.cfiFromPercentage(pct / 100);
            if (cfi) rendition.display(cfi);
          }
        },

        applySettings: function(newSettings) {
          currentSettings = Object.assign({}, currentSettings, newSettings);
          updateTheme(currentSettings);
        },

        changeFlow: function(flow) {
          if (flow === currentSettings.flow) return;
          currentSettings.flow = flow;
          if (rendition) {
            rendition.flow(flow === 'scrolled' ? 'scrolled-doc' : 'paginated');
            updateTheme(currentSettings);
          }
        },

        search: function(query) {
          if (!book || !book.spine) return;
          var spineItems = book.spine.spineItems || [];
          Promise.all(
            spineItems.map(function(item) {
              return item.load(book.load.bind(book)).then(function() {
                return item.find(query);
              }).finally(function() {
                item.unload();
              });
            })
          ).then(function(results) {
            var flat = Array.prototype.concat.apply([], results);
            sendToParent({
              type: 'searchResults',
              query: query,
              results: flat
            });
          }).catch(function(err) {
            sendToParent({ type: 'error', message: '搜索失败: ' + err.message });
          });
        }
      };

      // Message listener for Web (window.addEventListener('message'))
      window.addEventListener('message', function(event) {
        try {
          var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (!data || !data.action) return;
          if (data.action === 'initBook') {
            window.ReaderApi.initBook(data.base64Data, data.initialCfi, data.settings);
          } else if (data.action === 'prevPage') {
            window.ReaderApi.prevPage();
          } else if (data.action === 'nextPage') {
            window.ReaderApi.nextPage();
          } else if (data.action === 'goToCfi') {
            window.ReaderApi.goToCfi(data.cfi);
          } else if (data.action === 'goToProgress') {
            window.ReaderApi.goToProgress(data.progress);
          } else if (data.action === 'applySettings') {
            window.ReaderApi.applySettings(data.settings);
          } else if (data.action === 'search') {
            window.ReaderApi.search(data.query);
          }
        } catch (e) {}
      });

      sendToParent({ type: 'readerReady' });
    })();
  </script>
</body>
</html>`;

const outTsPath = path.join(__dirname, '../src/components/reader/readerTemplate.ts');
const tsContent = `// Auto-generated by scripts/build-reader-html.js. DO NOT EDIT DIRECTLY.
export const READER_BUNDLE_HTML = ${JSON.stringify(clientHtml)};
`;

fs.mkdirSync(path.dirname(outTsPath), { recursive: true });
fs.writeFileSync(outTsPath, tsContent, 'utf8');
console.log('Successfully generated', outTsPath, 'size:', tsContent.length);
