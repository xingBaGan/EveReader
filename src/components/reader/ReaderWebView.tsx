import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

const WebViewComponent = RNWebView as any;

export interface ReaderWebViewProps {
  html: string;
  onMessage: (data: any) => void;
  style?: any;
}

export interface ReaderWebViewRef {
  postMessage: (action: string, payload?: Record<string, any>) => void;
}

export const ReaderWebView = forwardRef<ReaderWebViewRef, ReaderWebViewProps>(
  ({ html, onMessage, style }, ref) => {
    const webViewRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      postMessage: (action: string, payload?: Record<string, any>) => {
        const payloadStr = JSON.stringify({ action, ...payload });
        const js = `window.postMessage(${JSON.stringify(payloadStr)}, '*'); true;`;
        webViewRef.current?.injectJavaScript(js);
      },
    }));

    return (
      <View style={[styles.container, style]}>
        <WebViewComponent
          ref={webViewRef}
          source={{
            html,
            baseUrl: 'file:///',
          }}
          onMessage={(event: any) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data && data.type) {
                onMessage(data);
              }
            } catch {
              // Ignore non-json
            }
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          originWhitelist={['*']}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={styles.webView}
          scrollEnabled={false}
        />
      </View>
    );
  }
);

ReaderWebView.displayName = 'ReaderWebView.native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
