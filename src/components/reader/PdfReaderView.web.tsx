import React from 'react';
import { View, StyleSheet } from 'react-native';

interface PdfReaderViewProps {
  uri: string;
  onToggleBars: () => void;
}

export function PdfReaderView({ uri }: PdfReaderViewProps) {
  return (
    <View style={styles.container}>
      <iframe
        src={uri}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
        }}
        title="PDF Reader"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#18191a',
  },
});
