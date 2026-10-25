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
import { READER_THEMES, TocItem } from '../../types/reader';
import { X, BookOpen } from 'lucide-react-native';

interface ReaderTocDrawerProps {
  onSelectChapter: (href: string) => void;
}

export function ReaderTocDrawer({ onSelectChapter }: ReaderTocDrawerProps) {
  const isTocOpen = useReaderStore((s) => s.isTocOpen);
  const setIsTocOpen = useReaderStore((s) => s.setIsTocOpen);
  const toc = useReaderStore((s) => s.toc);
  const settings = useReaderStore((s) => s.settings);
  const currentChapterTitle = useReaderStore((s) => s.currentChapterTitle);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;

  if (!isTocOpen) return null;

  // Flatten nested TOC items
  const flattenToc = (items: TocItem[], depth = 0): { item: TocItem; depth: number }[] => {
    let result: { item: TocItem; depth: number }[] = [];
    for (const it of items) {
      result.push({ item: it, depth });
      if (it.subitems && it.subitems.length > 0) {
        result = result.concat(flattenToc(it.subitems, depth + 1));
      }
    }
    return result;
  };

  const flatList = flattenToc(toc);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={isTocOpen}
      onRequestClose={() => setIsTocOpen(false)}>
      <View style={styles.backdrop}>
        <TouchableWithoutFeedback onPress={() => setIsTocOpen(false)}>
          <View style={styles.outsideTouch} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.drawer,
            {
              backgroundColor: themeConfig.barBg,
              borderRightColor: themeConfig.barBorder,
            },
          ]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <BookOpen size={18} color={themeConfig.barText} />
              <Text style={[styles.headerTitle, { color: themeConfig.barText }]}>
                目录 ({flatList.length} 节)
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={() => setIsTocOpen(false)}>
              <X size={20} color={themeConfig.barText} />
            </Pressable>
          </View>

          {flatList.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: themeConfig.barText }]}>
                未发现章节目录
              </Text>
            </View>
          ) : (
            <FlatList
              data={flatList}
              keyExtractor={(entry, idx) => `${entry.item.id || entry.item.href}-${idx}`}
              contentContainerStyle={styles.listContent}
              renderItem={({ item: entry }) => {
                const label = entry.item.label ? entry.item.label.trim() : '未命名章节';
                const isActive =
                  currentChapterTitle &&
                  label.toLowerCase() === currentChapterTitle.toLowerCase();

                return (
                  <Pressable
                    style={[
                      styles.chapterItem,
                      { paddingLeft: 16 + entry.depth * 16 },
                      isActive && styles.activeChapterItem,
                    ]}
                    onPress={() => {
                      onSelectChapter(entry.item.href);
                      setIsTocOpen(false);
                    }}>
                    <Text
                      style={[
                        styles.chapterText,
                        { color: themeConfig.barText },
                        isActive && styles.activeChapterText,
                      ]}
                      numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexDirection: 'row',
  },
  outsideTouch: {
    flex: 1,
  },
  drawer: {
    width: '82%',
    maxWidth: 380,
    height: '100%',
    borderRightWidth: 1,
    paddingTop: 48,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  listContent: {
    paddingVertical: 8,
  },
  chapterItem: {
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.1)',
  },
  activeChapterItem: {
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: '#0284c7',
  },
  chapterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  activeChapterText: {
    color: '#0284c7',
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    opacity: 0.6,
  },
});
