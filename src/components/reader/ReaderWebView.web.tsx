import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';

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
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && data.type) {
            onMessage(data);
          }
        } catch {
          // Ignore non-json messages
        }
      };

      window.addEventListener('message', handleMessage);
      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }, [onMessage]);

    useImperativeHandle(ref, () => ({
      postMessage: (action: string, payload?: Record<string, any>) => {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({ action, ...payload }),
            '*'
          );
        }
      },
    }));

    return (
      <View style={[styles.container, style]}>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            backgroundColor: 'transparent',
          }}
          title="Reader"
          sandbox="allow-scripts allow-same-origin"
        />
      </View>
    );
  }
);

ReaderWebView.displayName = 'ReaderWebView.web';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
