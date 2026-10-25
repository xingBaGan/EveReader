import { create } from 'zustand';
import { ZLibBook } from '../types/zlib';

interface BookDetailState {
  isOpen: boolean;
  book: ZLibBook | null;
  openBookDetail: (book: ZLibBook) => void;
  closeBookDetail: () => void;
}

export const useBookDetailStore = create<BookDetailState>((set) => ({
  isOpen: false,
  book: null,
  openBookDetail: (book: ZLibBook) => {
    set({ isOpen: true, book });
  },
  closeBookDetail: () => {
    set({ isOpen: false, book: null });
  },
}));
