import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

export interface PickedBookFile {
  name: string;
  uri: string;
  size?: number;
}

export async function pickLocalBookFile(): Promise<PickedBookFile | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub,.pdf,.txt,.mobi,.azw3,application/pdf,application/epub+zip,text/plain';
      input.style.position = 'fixed';
      input.style.top = '-9999px';
      input.style.left = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }

        if (!file) {
          resolve(null);
          return;
        }

        const uri = URL.createObjectURL(file);
        resolve({
          name: file.name,
          uri,
          size: file.size,
        });
      };

      const cleanup = () => {
        setTimeout(() => {
          if (document.body.contains(input)) {
            document.body.removeChild(input);
          }
          window.removeEventListener('focus', cleanup);
        }, 1500);
      };
      window.addEventListener('focus', cleanup);

      input.click();
    });
  }

  // Native (iOS / Android) using Expo FileSystem File.pickFileAsync
  try {
    const rawResult: any = await (File as any).pickFileAsync({
      mimeTypes: ['application/pdf', 'application/epub+zip', 'text/plain', '*/*'],
    });

    if (!rawResult || rawResult.canceled) {
      return null;
    }

    let fileObj: any = null;
    if (rawResult.result) {
      fileObj = Array.isArray(rawResult.result) ? rawResult.result[0] : rawResult.result;
    } else if (rawResult.assets && rawResult.assets.length > 0) {
      fileObj = rawResult.assets[0];
    } else if (rawResult.uri) {
      fileObj = rawResult;
    }

    if (!fileObj || !fileObj.uri) {
      return null;
    }

    const sourceUri = fileObj.uri;
    const fileName = fileObj.name || sourceUri.split('/').pop() || 'imported_book.pdf';
    const fileSize = fileObj.size;

    // Permanently copy file to app's document directory so it never expires
    let persistentUri = sourceUri;
    try {
      if (FileSystem.documentDirectory) {
        const sanitized = fileName.replace(/[/\\?%*:|"<>]/g, '_');
        const dest = `${FileSystem.documentDirectory}imported_${Date.now()}_${sanitized}`;
        await FileSystem.copyAsync({ from: sourceUri, to: dest });
        persistentUri = dest;
      }
    } catch (copyErr) {
      console.warn('Failed to copy file to documentDirectory, using sourceUri:', copyErr);
    }

    return {
      name: fileName,
      uri: persistentUri,
      size: fileSize,
    };
  } catch (e) {
    console.warn('pickLocalBookFile error:', e);
    return null;
  }
}
