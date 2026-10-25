import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, List, Bookmark, Search, SlidersHorizontal, MessageSquare } from 'lucide-react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';

export function ReaderTopBar() {
  const currentBook = useReaderStore((s) => s.currentBook);
  const currentChapterTitle = useReaderStore((s) => s.currentChapterTitle);
  const settings = useReaderStore((s) => s.settings);
  const closeReader = useReaderStore((s) => s.closeReader);
  const setIsTocOpen = useReaderStore((s) => s.setIsTocOpen);
  const setIsSettingsOpen = useReaderStore((s) => s.setIsSettingsOpen);
  const setIsSearchOpen = useReaderStore((s) => s.setIsSearchOpen);
  const setIsBookmarksOpen = useReaderStore((s) => s.setIsBookmarksOpen);
  const addBookmark = useReaderStore((s) => s.addBookmark);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const currentCfi = useReaderStore((s) => s.currentCfi);
  const isBubbleDetectActive = useReaderStore((s) => s.isBubbleDetectActive);
  const toggleBubbleDetection = useReaderStore((s) => s.toggleBubbleDetection);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isBookmarked = bookmarks.some(
    (b) => b.bookId === currentBook?.id && b.cfiOrLocation === currentCfi
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.container,
        {
          backgroundColor: themeConfig.barBg,
          borderBottomColor: themeConfig.barBorder,
        },
      ]}>
      <View style={styles.content}>
        <Pressable style={styles.iconBtn} onPress={closeReader}>
          <ChevronLeft size={24} color={themeConfig.barText} />
        </Pressable>

        <View style={styles.titleArea}>
          <Text
            style={[styles.bookTitle, { color: themeConfig.barText }]}
            numberOfLines={1}>
            {currentBook?.title || '正在阅读'}
          </Text>
          {currentChapterTitle ? (
            <Text style={[styles.chapterTitle, { color: themeConfig.barText }]} numberOfLines={1}>
              {currentChapterTitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.iconBtn} onPress={() => setIsTocOpen(true)}>
            <List size={20} color={themeConfig.barText} />
          </Pressable>

          <Pressable
            style={styles.iconBtn}
            onPress={() => (isBookmarked ? setIsBookmarksOpen(true) : addBookmark())}>
            <Bookmark
              size={20}
              color={isBookmarked ? '#e11d48' : themeConfig.barText}
              fill={isBookmarked ? '#e11d48' : 'none'}
            />
          </Pressable>

          {/* 气泡检测快捷切换按钮 */}
          <Pressable
            style={[styles.iconBtn, isBubbleDetectActive && styles.activeIconBtn]}
            onPress={() => toggleBubbleDetection()}
            hitSlop={8}>
            <MessageSquare
              size={20}
              color={isBubbleDetectActive ? '#38bdf8' : themeConfig.barText}
              fill={isBubbleDetectActive ? 'rgba(56, 189, 248, 0.2)' : 'none'}
            />
            {isBubbleDetectActive ? <View style={styles.activeDot} /> : null}
          </Pressable>

          <Pressable style={styles.iconBtn} onPress={() => setIsSearchOpen(true)}>
            <Search size={20} color={themeConfig.barText} />
          </Pressable>

          <Pressable style={styles.iconBtn} onPress={() => setIsSettingsOpen(true)}>
            <SlidersHorizontal size={20} color={themeConfig.barText} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  content: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    position: 'relative',
  },
  activeIconBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  activeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38bdf8',
  },
  titleArea: {
    flex: 1,
    marginHorizontal: 8,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  chapterTitle: {
    fontSize: 11,
    opacity: 0.7,
    marginTop: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
