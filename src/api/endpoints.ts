import { apiClient } from './client';
import {
  ZLibBookSingle,
  ZLibBooksListing,
  ZLibFileListing,
  ZLibBookFormats,
  ZLibHostsListing,
  ZLibUserListing,
  SearchFilters,
} from '../types/zlib';

export const zlibApi = {
  /**
   * User login with email and password
   */
  async login(email: string, password: string, authToken: string = ''): Promise<ZLibUserListing> {
    const params = new URLSearchParams();
    params.append('email', email);
    params.append('password', password);
    params.append('auth_token', authToken);

    const response = await apiClient.post<ZLibUserListing>(
      '/eapi/user/login',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data;
  },

  /**
   * Get current user profile details
   */
  async getProfile(): Promise<ZLibUserListing> {
    const response = await apiClient.get<ZLibUserListing>('/eapi/user/profile');
    return response.data;
  },

  /**
   * Search books with filters, pagination, language and extension options
   */
  async searchBooks(filters: SearchFilters): Promise<ZLibBooksListing> {
    const params = new URLSearchParams();
    params.append('message', filters.message);
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.order) params.append('order', filters.order);
    if (filters.yearFrom) params.append('yearFrom', filters.yearFrom.toString());
    if (filters.yearTo) params.append('yearTo', filters.yearTo.toString());
    if (filters.exactMatching) params.append('e', '1');

    if (filters.languages && filters.languages.length > 0) {
      filters.languages.forEach((lang) => params.append('languages[]', lang));
    }
    if (filters.extensions && filters.extensions.length > 0) {
      filters.extensions.forEach((ext) => params.append('extensions[]', ext));
    }

    const response = await apiClient.post<ZLibBooksListing>(
      '/eapi/book/search',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data;
  },

  /**
   * Fetch most popular books
   */
  async getMostPopular(page: number = 1): Promise<ZLibBooksListing> {
    const response = await apiClient.get<ZLibBooksListing>('/eapi/book/most-popular', {
      params: { page },
    });
    return response.data;
  },

  /**
   * Fetch recently added books
   */
  async getRecentlyAdded(page: number = 1): Promise<ZLibBooksListing> {
    const response = await apiClient.get<ZLibBooksListing>('/eapi/book/recently', {
      params: { page },
    });
    return response.data;
  },

  /**
   * Fetch user recommendations
   */
  async getRecommendations(): Promise<ZLibBooksListing> {
    const response = await apiClient.get<ZLibBooksListing>('/eapi/user/book/recommended');
    return response.data;
  },

  /**
   * Fetch full details for a single book
   */
  async getBookDetail(id: number, hash: string): Promise<ZLibBookSingle> {
    const response = await apiClient.get<ZLibBookSingle>(`/eapi/book/${id}/${hash}`);
    return response.data;
  },

  /**
   * Fetch available formats / conversion options for a book
   */
  async getBookFormats(id: number, hash: string): Promise<ZLibBookFormats> {
    const response = await apiClient.get<ZLibBookFormats>(`/eapi/book/${id}/${hash}/formats`);
    return response.data;
  },

  /**
   * Fetch direct download CDN link for a book
   */
  async getDownloadLink(id: number, hash: string): Promise<ZLibFileListing> {
    const response = await apiClient.get<ZLibFileListing>(`/eapi/book/${id}/${hash}/file`);
    return response.data;
  },

  /**
   * Get user's saved / bookmarked books
   */
  async getSavedBooks(page: number = 1, limit: number = 20): Promise<ZLibBooksListing> {
    const response = await apiClient.get<ZLibBooksListing>('/eapi/user/book/saved', {
      params: { page, limit },
    });
    return response.data;
  },

  /**
   * Save / bookmark a book to user's library
   */
  async saveBook(bookId: number): Promise<{ success: number }> {
    const response = await apiClient.get<{ success: number }>(`/eapi/user/book/${bookId}/save`);
    return response.data;
  },

  /**
   * Unsave / remove a book from user's library
   */
  async unsaveBook(bookId: number): Promise<{ success: number }> {
    const response = await apiClient.get<{ success: number }>(`/eapi/user/book/${bookId}/unsave`);
    return response.data;
  },

  /**
   * Get history of downloaded books
   */
  async getDownloadedBooks(page: number = 1, limit: number = 20): Promise<ZLibBooksListing> {
    const response = await apiClient.get<ZLibBooksListing>('/eapi/user/book/downloaded', {
      params: { page, limit },
    });
    return response.data;
  },

  /**
   * Fetch official list of active mirror domains
   */
  async getDomains(): Promise<ZLibHostsListing> {
    const response = await apiClient.get<ZLibHostsListing>('/eapi/info/domains');
    return response.data;
  },
};
