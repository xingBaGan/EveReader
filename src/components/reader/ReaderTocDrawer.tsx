import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
  TextInput,
  Keyboard,
} from 'react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES, TocItem } from '../../types/reader';
import { X, BookOpen, ArrowRight, Hash, Layers } from 'lucide-react-native';

interface ReaderTocDrawerProps {
  onSelectChapter: (href: string) => void;
}

export function ReaderTocDrawer({ onSelectChapter }: ReaderTocDrawerProps) {
  const isTocOpen = useReaderStore((s) => s.isTocOpen);
  const setIsTocOpen = useReaderStore((s) => s.setIsTocOpen);
  const toc = useReaderStore((s) => s.toc);
  const settings = useReaderStore((s) => s.settings);
  const currentChapterTitle = useReaderStore((s) => s.currentChapterTitle);
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const currentBook = useReaderStore((s) => s.currentBook);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isDark = settings.theme === 'dark' || settings.theme === 'black';

  const isPdf =
    currentBook?.extension.toLowerCase() === 'pdf' ||
    (totalPages > 1 && (!toc || toc.length === 0));

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

  const flatList = useMemo(() => flattenToc(toc), [toc]);

  // Tab: 'chapters' or 'pages'
  const [activeTab, setActiveTab] = useState<'chapters' | 'pages'>('chapters');
  const [jumpPageText, setJumpPageText] = useState('');
  const [inputError, setInputError] = useState(false);
  const pageFlatListRef = useRef<FlatList<number>>(null);

  // Default to 'pages' if PDF has no embedded TOC
  useEffect(() => {
    if (isPdf && flatList.length === 0) {
      setActiveTab('pages');
    } else if (flatList.length > 0) {
      setActiveTab('chapters');
    }
  }, [isPdf, flatList.length, isTocOpen]);

  // Generate page list for PDF
  const pagesList = useMemo(() => {
    const count = Math.max(1, totalPages || 1);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [totalPages]);

  // Auto scroll to current page in pages tab
  useEffect(() => {
    if (isTocOpen && activeTab === 'pages' && totalPages > 1) {
      const targetIndex = Math.max(0, Math.min(totalPages - 1, currentPage - 1));
      const timer = setTimeout(() => {
        try {
          pageFlatListRef.current?.scrollToIndex({
            index: targetIndex,
            animated: false,
            viewPosition: 0.3,
          });
        } catch {}
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isTocOpen, activeTab, currentPage, totalPages]);

  if (!isTocOpen) return null;

  const handlePageJump = (page: number) => {
    if (page < 1 || page > totalPages) {
      setInputError(true);
      return;
    }
    setInputError(false);
    Keyboard.dismiss();
    onSelectChapter(String(page));
    setIsTocOpen(false);
  };

  const handleInputSubmit = () => {
    const num = parseInt(jumpPageText.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      handlePageJump(num);
      setJumpPageText('');
    } else {
      setInputError(true);
    }
  };

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
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {activeTab === 'pages' ? (
                <Hash size={18} color={themeConfig.barText} />
              ) : (
                <BookOpen size={18} color={themeConfig.barText} />
              )}
              <Text style={[styles.headerTitle, { color: themeConfig.barText }]}>
                {isPdf && activeTab === 'pages'
                  ? `页码直达 (${totalPages} 页)`
                  : `目录 (${flatList.length} 节)`}
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={() => setIsTocOpen(false)}>
              <X size={20} color={themeConfig.barText} />
            </Pressable>
          </View>

          {/* Segmented Tabs (When PDF has both TOC & page mode) */}
          {isPdf && flatList.length > 0 && (
            <View style={styles.tabsRow}>
              <Pressable
                style={[
                  styles.tabBtn,
                  activeTab === 'chapters' && [
                    styles.activeTabBtn,
                    { borderBottomColor: '#0284c7' },
                  ],
                ]}
                onPress={() => setActiveTab('chapters')}>
                <Text
                  style={[
                    styles.tabBtnText,
                    { color: themeConfig.barText },
                    activeTab === 'chapters' && styles.activeTabBtnText,
                  ]}>
                  章节 ({flatList.length})
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.tabBtn,
                  activeTab === 'pages' && [
                    styles.activeTabBtn,
                    { borderBottomColor: '#0284c7' },
                  ],
                ]}
                onPress={() => setActiveTab('pages')}>
                <Text
                  style={[
                    styles.tabBtnText,
                    { color: themeConfig.barText },
                    activeTab === 'pages' && styles.activeTabBtnText,
                  ]}>
                  全部页码 ({totalPages})
                </Text>
              </Pressable>
            </View>
          )}

          {/* PDF Pages View */}
          {activeTab === 'pages' && isPdf ? (
            <View style={styles.pagesContainer}>
              {/* Quick Jump Input Bar */}
              <View
                style={[
                  styles.jumpBar,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    borderColor: inputError ? '#ef4444' : 'transparent',
                  },
                ]}>
                <TextInput
                  style={[styles.jumpInput, { color: themeConfig.barText }]}
                  placeholder={`输入页码 1 ~ ${totalPages}`}
                  placeholderTextColor={isDark ? '#64748b' : '#94a3b8'}
                  keyboardType="number-pad"
                  value={jumpPageText}
                  onChangeText={(t) => {
                    setJumpPageText(t);
                    if (inputError) setInputError(false);
                  }}
                  onSubmitEditing={handleInputSubmit}
                  returnKeyType="go"
                />
                <Pressable style={styles.jumpBtn} onPress={handleInputSubmit}>
                  <Text style={styles.jumpBtnText}>跳转</Text>
                  <ArrowRight size={14} color="#ffffff" />
                </Pressable>
              </View>

              {/* Fast Jump Shortcuts */}
              <View style={styles.chipsRow}>
                <Pressable
                  style={[styles.chip, { backgroundColor: isDark ? '#27272a' : '#e2e8f0' }]}
                  onPress={() => handlePageJump(1)}>
                  <Text style={[styles.chipText, { color: themeConfig.barText }]}>首页 P.1</Text>
                </Pressable>

                <Pressable
                  style={[styles.chip, styles.activeChip]}
                  onPress={() => {
                    try {
                      pageFlatListRef.current?.scrollToIndex({
                        index: Math.max(0, currentPage - 1),
                        animated: true,
                        viewPosition: 0.3,
                      });
                    } catch {}
                  }}>
                  <Text style={styles.activeChipText}>定位当前 P.{currentPage}</Text>
                </Pressable>

                <Pressable
                  style={[styles.chip, { backgroundColor: isDark ? '#27272a' : '#e2e8f0' }]}
                  onPress={() => handlePageJump(totalPages)}>
                  <Text style={[styles.chipText, { color: themeConfig.barText }]}>
                    末页 P.{totalPages}
                  </Text>
                </Pressable>
              </View>

              {/* Virtualized Page List */}
              <FlatList
                ref={pageFlatListRef}
                data={pagesList}
                keyExtractor={(p) => `pdf_page_${p}`}
                contentContainerStyle={styles.listContent}
                initialNumToRender={25}
                maxToRenderPerBatch={30}
                windowSize={11}
                getItemLayout={(_, index) => ({
                  length: 48,
                  offset: 48 * index,
                  index,
                })}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    try {
                      pageFlatListRef.current?.scrollToIndex({
                        index: info.index,
                        animated: false,
                        viewPosition: 0.3,
                      });
                    } catch {}
                  }, 100);
                }}
                renderItem={({ item: page }) => {
                  const isActive = page === currentPage;
                  const progressPct = ((page / totalPages) * 100).toFixed(0);

                  return (
                    <Pressable
                      style={[styles.pageItem, isActive && styles.activeChapterItem]}
                      onPress={() => handlePageJump(page)}>
                      <View style={styles.pageItemLeft}>
                        <Text
                          style={[
                            styles.chapterText,
                            { color: themeConfig.barText },
                            isActive && styles.activeChapterText,
                          ]}>
                          第 {page} 页
                        </Text>
                        {isActive && (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>当前浏览</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.pagePercentText,
                          { color: isDark ? '#64748b' : '#94a3b8' },
                          isActive && { color: '#0284c7' },
                        ]}>
                        {progressPct}%
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          ) : (
            /* Chapters Outline View */
            flatList.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Layers size={36} color={isDark ? '#475569' : '#cbd5e1'} style={{ marginBottom: 12 }} />
                <Text style={[styles.emptyText, { color: themeConfig.barText }]}>
                  {isPdf ? '该 PDF 未提供明确目录，已支持按页数跳转' : '未发现章节目录'}
                </Text>
                {isPdf && (
                  <Pressable
                    style={styles.switchPagesBtn}
                    onPress={() => setActiveTab('pages')}>
                    <Text style={styles.switchPagesBtnText}>按全部 {totalPages} 页浏览</Text>
                  </Pressable>
                )}
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
            )
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
    width: '85%',
    maxWidth: 400,
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
    paddingBottom: 14,
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
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.2)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: '#0284c7',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  activeTabBtnText: {
    color: '#0284c7',
    opacity: 1,
    fontWeight: '700',
  },
  pagesContainer: {
    flex: 1,
  },
  jumpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  jumpInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 6,
  },
  jumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  jumpBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  activeChip: {
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  activeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284c7',
  },
  listContent: {
    paddingVertical: 4,
  },
  chapterItem: {
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.1)',
  },
  pageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(100, 116, 139, 0.08)',
  },
  pageItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  pagePercentText: {
    fontSize: 12,
    fontWeight: '600',
  },
  currentBadge: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  currentBadgeText: {
    color: '#ffffff',
    fontSize: 10,
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
    textAlign: 'center',
  },
  switchPagesBtn: {
    marginTop: 14,
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  switchPagesBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
