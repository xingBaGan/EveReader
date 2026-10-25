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
    config.headers['remix-userid'] = user.id.toString();
    config.headers['remix-userkey'] = user.remix_userkey;
    config.headers['Cookie'] = `remix_userId=${user.id}; remix_userkey=${user.remix_userkey}`;
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
