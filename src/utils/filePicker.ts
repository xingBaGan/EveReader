import { Platform } from 'react-native';
import { File } from 'expo-file-system';

export interface PickedBookFile {
  name: string;
  uri: string;
  size?: number;
}

export async function pickLocalBookFile(): Promise<PickedBookFile | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub,.txt,.pdf,.mobi,.azw3';
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
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
      input.click();
    });
  }

  // Native (iOS/Android) using Expo FileSystem File.pickFileAsync
  try {
    const result: any = await (File as any).pickFileAsync({
      mimeType: ['application/epub+zip', 'text/plain', 'application/pdf', '*/*'],
    });

    if (!result) return null;

    // Handle single or array return
    const picked = Array.isArray(result) ? result[0] : result;
    if (picked && picked.uri) {
      return {
        name: picked.name || '本地书籍',
        uri: picked.uri,
        size: picked.size,
      };
    }
  } catch (e) {
    console.warn('pickFileAsync error:', e);
  }

  return null;
}
