import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export async function readBookAsBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    // On web, uri might be a blob: or data: or http URL
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // strip data:*/*;base64,
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Native (iOS / Android)
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function readBookAsText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return await response.text();
  }
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function saveJsonFile(filename: string, data: any): Promise<void> {
  const jsonStr = JSON.stringify(data);
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`zlib_${filename}`, jsonStr);
    }
    return;
  }
  const fileUri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, jsonStr, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function loadJsonFile<T>(filename: string): Promise<T | null> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      const str = window.localStorage.getItem(`zlib_${filename}`);
      if (str) {
        try {
          return JSON.parse(str) as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  const fileUri = `${FileSystem.documentDirectory}${filename}`;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) return null;

  try {
    const content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
