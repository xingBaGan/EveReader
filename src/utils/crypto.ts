import CryptoJS from 'crypto-js';
import { Config } from '../constants/config';

const AES_KEY = CryptoJS.enc.Utf8.parse(Config.AES_KEY);
const AES_IV = CryptoJS.enc.Hex.parse('00000000000000000000000000000000'); // 16 zero bytes

/**
 * Decrypts dynamic domain payload from https://1lib.domains/
 * @param cipherBase64 Base64 encoded encrypted string
 * @returns Plaintext JSON string of active mirror domains
 */
export function decryptDomainPayload(cipherBase64: string): string {
  try {
    const decrypted = CryptoJS.AES.decrypt(cipherBase64, AES_KEY, {
      iv: AES_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Failed to decrypt domain payload:', error);
    return '';
  }
}
