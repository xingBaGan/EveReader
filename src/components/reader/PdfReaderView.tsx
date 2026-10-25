import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const WebViewComponent = WebView as any;

interface PdfReaderViewProps {
  uri: string;
  onToggleBars: () => void;
}

export function PdfReaderView({ uri }: PdfReaderViewProps) {
  // On iOS, WebView natively renders PDF files with full zoom/scroll
  const source =
    Platform.OS === 'android' && uri.startsWith('http')
      ? { uri: `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(uri)}` }
      : { uri };

  return (
    <View style={styles.container}>
      <WebViewComponent
        source={source}
        style={styles.webView}
        originWhitelist={['*']}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        scalesPageToFit={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#18191a',
  },
  webView: {
    flex: 1,
  },
});
