import axios from 'axios';
import { useAuthStore } from '../stores/useAuthStore';
import { useDomainStore } from '../stores/useDomainStore';
import { Config } from '../constants/config';

export const apiClient = axios.create({
  timeout: 15000,
  headers: {
    'Authorization': Config.CLIENT_SECRET,
    'source': 'android',
    'ANDROID-APP-VERSION': '1.11.4',
    'appversion': '1.11.4',
    'ANDROID-APP-LANGUAGE': 'zh',
    'ANDROID-OS-VERSION': '33',
    'ANDROID-MOBILE-VERSION': 'Pixel 7',
  },
});

// Request Interceptor: Injects dynamic BaseURL and User Authentication headers
apiClient.interceptors.request.use((config) => {
  const currentBaseUrl = useDomainStore.getState().currentBaseUrl;
  if (currentBaseUrl) {
    config.baseURL = currentBaseUrl;
  }

  const user = useAuthStore.getState().user;
  if (user && user.id && user.remix_userkey) {
    const userIdStr = user.id.toString();
    const userKeyStr = user.remix_userkey;
    const cookieStr = `remix_userId=${userIdStr}; remix_userkey=${userKeyStr}`;

    if (config.headers && typeof (config.headers as any).set === 'function') {
      (config.headers as any).set('remix-userid', userIdStr);
      (config.headers as any).set('remix-userkey', userKeyStr);
      (config.headers as any).set('Cookie', cookieStr);
    }
    if (config.headers) {
      config.headers['remix-userid'] = userIdStr;
      config.headers['remix-userkey'] = userKeyStr;
      config.headers['Cookie'] = cookieStr;
    }
  }

  return config;
});

// Response Interceptor: Error handling & dynamic domain fallback
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If network connection failed or timed out, attempt to switch to backup mirror
    if (error.code === 'ECONNABORTED' || !error.response || error.response.status >= 500) {
      console.warn('Current mirror unresponsive, switching to next mirror...');
      const nextDomain = await useDomainStore.getState().switchToNextAvailableDomain();
      if (error.config && error.config._retry !== true) {
        error.config._retry = true;
        error.config.baseURL = nextDomain;
        return apiClient.request(error.config);
      }
    }
    return Promise.reject(error);
  }
);
