/**
 * Z-Library Data Contracts
 * Extracted directly from 1.11.4.APK bytecode (Moshi / Kotlin models)
 */

export interface ZLibBook {
  id: number;
  hash: string;
  title: string;
  author: string;
  cover: string;
  description?: string;
  extension: string; // "epub" | "pdf" | "mobi" | "azw3" etc.
  filesize: number; // bytes
  filesizeString: string; // e.g. "2.4 MB"
  year: number;
  publisher?: string;
  pages: number;
  language: string;
  identifier?: string; // ISBN
  series?: string;
  volume?: string;
  edition?: string;
  dl?: string;
  dlDate?: string;
  preview?: string;
  href?: string;
  readOnlineAvailable?: boolean;
  readOnlineUrl?: string;
  isUserSavedBook?: boolean;
  _isUserSavedBook?: boolean;
  kindleAvailable?: boolean;
  isSendToEmailAvailable?: boolean;
  sendToEmailAvailable?: boolean;
}

export interface ZLibPagination {
  current: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  beforePage: number;
  nextPage: number;
}

export interface ZLibBooksListing {
  success: number;
  books: ZLibBook[];
  pagination: ZLibPagination;
  exactBooksCount?: number;
}

export interface ZLibBookSingle {
  success: number;
  book?: ZLibBook;
  error?: string;
}

export interface ZLibFile {
  allowDownload: boolean;
  author: string;
  description?: string;
  downloadLink?: string; // Real property returned by official API
  dlLink?: string; // Compatibility alias
  extension: string;
}

export interface ZLibFileListing {
  success: number;
  file?: ZLibFile;
  error?: string;
  message?: string;
}

export interface ZLibFormat {
  id: number;
  hash: string;
  extension: string;
  filesize: number;
  filesizeString: string;
}

export interface ZLibBookFormats {
  success: number;
  formats?: ZLibFormat[];
  books?: ZLibBook[];
  error?: string;
}

export interface ZLibUser {
  id: number;
  email: string;
  name: string;
  remix_userkey: string;
  downloads_today: number;
  downloads_limit: number;
  isPremium: number;
  isConfirmed: number;
  kindle?: string;
  donations_active?: number;
  donations_expire?: string;
  personalDomains: string[];
}

export interface ZLibUserListing {
  success: number;
  error?: string;
  user?: ZLibUser;
}

export interface ZLibHost {
  domain: string;
  contentAvailable: boolean;
  premium: boolean;
  isRedirector: boolean;
}

export interface ZLibHostsListing {
  success: number;
  domains: ZLibHost[];
}

export interface SearchFilters {
  message: string;
  page?: number;
  limit?: number;
  order?: 'popular' | 'date' | 'title';
  yearFrom?: number;
  yearTo?: number;
  languages?: string[];
  extensions?: string[];
  exactMatching?: boolean;
}
