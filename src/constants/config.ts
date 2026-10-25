/**
 * Application Configuration
 * Loads environment variables injected by Expo (EXPO_PUBLIC_ prefix).
 * Keeps source code clean and free of hardcoded secrets.
 */

export const Config = {
  // Official Client Secret (Authorization header)
  CLIENT_SECRET: process.env.EXPO_PUBLIC_ZLIB_CLIENT_SECRET || '',

  // AES-128-CBC key for decrypting domain payloads
  AES_KEY: process.env.EXPO_PUBLIC_AES_KEY || '',

  // Default API Proxy URL (e.g. https://zlib.atujii.top)
  DEFAULT_API_URL: process.env.EXPO_PUBLIC_DEFAULT_API_URL || '',

  // Fallback public mirrors list
  FALLBACK_MIRRORS: [
    process.env.EXPO_PUBLIC_DEFAULT_API_URL,
    'https://singlelogin.rs',
    'https://1lib.sk',
    'https://z-library.sk',
  ].filter(Boolean) as string[],
};
