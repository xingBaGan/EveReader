import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
} from 'react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';
import { X, Trash2, Bookmark } from 'lucide-react-native';

interface ReaderBookmarksModalProps {
  onSelectBookmark: (location: string) => void;
}

export function ReaderBookmarksModal({ onSelectBookmark }: ReaderBookmarksModalProps) {
  const isBookmarksOpen = useReaderStore((s) => s.isBookmarksOpen);
  const setIsBookmarksOpen = useReaderStore((s) => s.setIsBookmarksOpen);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const removeBookmark = useReaderStore((s) => s.removeBookmark);
  const currentBook = useReaderStore((s) => s.currentBook);
  const settings = useReaderStore((s) => s.settings);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const bookBookmarks = bookmarks.filter((b) => b.bookId === currentBook?.id);

  if (!isBookmarksOpen) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={isBookmarksOpen}
      onRequestClose={() => setIsBookmarksOpen(false)}>
      <TouchableWithoutFeedback onPress={() => setIsBookmarksOpen(false)}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: themeConfig.barBg,
                  borderColor: themeConfig.barBorder,
                },
              ]}>
              <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                  <Bookmark size={18} color="#e11d48" fill="#e11d48" />
                  <Text style={[styles.title, { color: themeConfig.barText }]}>
                    书签列表 ({bookBookmarks.length})
                  </Text>
                </View>
                <Pressable onPress={() => setIsBookmarksOpen(false)} style={styles.closeBtn}>
                  <X size={20} color={themeConfig.barText} />
                </Pressable>
              </View>

              {bookBookmarks.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Bookmark size={36} color="rgba(100, 116, 139, 0.4)" />
                  <Text style={[styles.emptyText, { color: themeConfig.barText }]}>
                    当前图书暂无书签
                  </Text>
                  <Text style={styles.emptySubText}>
                    在阅读时点击顶部栏的书签图标即可快速收藏当前位置
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={bookBookmarks}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.bookmarkItem}
                      onPress={() => {
                        onSelectBookmark(item.cfiOrLocation);
                        setIsBookmarksOpen(false);
                      }}>
                      <View style={styles.itemInfo}>
                        <Text
                          style={[styles.itemChapter, { color: themeConfig.barText }]}
                          numberOfLines={1}>
                          {item.chapterTitle || '书签'} · {item.percentage}%
                        </Text>
                        <Text style={styles.itemExcerpt} numberOfLines={2}>
                          {item.excerpt}
                        </Text>
                        <Text style={styles.itemDate}>
                          {new Date(item.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.deleteBtn}
                        onPress={(e) => {
                          e.stopPropagation();
                          removeBookmark(item.id);
                        }}>
                        <Trash2 size={16} color="#ef4444" />
                      </Pressable>
                    </Pressable>
                  )}
                />
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
  bookmarkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.15)',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemChapter: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
  },
  itemExcerpt: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
    marginBottom: 4,
  },
  itemDate: {
    fontSize: 10,
    color: '#94a3b8',
  },
  deleteBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});
