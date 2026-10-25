import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { zlibApi } from '../api/endpoints';
import { BookCard } from '../components/BookCard';
import { useDownloadStore } from '../stores/useDownloadStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useBookshelfStore } from '../stores/useBookshelfStore';
import { useReaderStore } from '../stores/useReaderStore';
import { BookshelfItem } from '../types/reader';
import { pickLocalBookFile } from '../utils/filePicker';
import * as Sharing from 'expo-sharing';
import {
  History,
  Bookmark,
  Library,
  LayoutGrid,
  List as ListIcon,
  Plus,
  BookOpen,
  MoreVertical,
  CheckCircle,
  FileText,
} from 'lucide-react-native';

export default function ShelfScreen() {
  const [activeTab, setActiveTab] = useState<'bookshelf' | 'cloud_downloaded' | 'saved'>('bookshelf');
  const [importedNotice, setImportedNotice] = useState<BookshelfItem | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const user = useAuthStore((s) => s.user);

  const bookshelfBooks = useBookshelfStore((s) => s.books);
  const viewMode = useBookshelfStore((s) => s.viewMode);
  const setViewMode = useBookshelfStore((s) => s.setViewMode);
  const sortBy = useBookshelfStore((s) => s.sortBy);
  const setSortBy = useBookshelfStore((s) => s.setSortBy);
  const filterFormat = useBookshelfStore((s) => s.filterFormat);
  const setFilterFormat = useBookshelfStore((s) => s.setFilterFormat);
  const loadBookshelf = useBookshelfStore((s) => s.loadBookshelf);
  const importLocalBook = useBookshelfStore((s) => s.importLocalBook);
  const removeBook = useBookshelfStore((s) => s.removeBook);
  const openReader = useReaderStore((s) => s.openReader);

  useEffect(() => {
    loadBookshelf();
    // Also sync any completed downloads from useDownloadStore into bookshelf
    const tasks = useDownloadStore.getState().tasks;
    Object.values(tasks).forEach((t) => {
      if (t.status === 'completed' && t.localUri && !bookshelfBooks[t.bookId]) {
        useBookshelfStore.getState().addOrUpdateBook({
          id: t.bookId,
          title: t.title,
          cover: t.cover,
          extension: t.extension,
          filesizeString: t.filesizeString,
          localUri: t.localUri,
          source: 'download',
        });
      }
    });
  }, []);

  // 1. Fetch Cloud Account Download History
  const {
    data: cloudDownloadedData,
    isLoading: isLoadingCloudDl,
  } = useQuery({
    queryKey: ['cloudDownloadedBooks', user?.id],
    queryFn: () => zlibApi.getDownloadedBooks(1, 30),
    enabled: activeTab === 'cloud_downloaded' && !!user,
  });

  // 2. Fetch Cloud Saved / Favorites
  const {
    data: savedData,
    isLoading: isLoadingSaved,
  } = useQuery({
    queryKey: ['savedBooks', user?.id],
    queryFn: () => zlibApi.getSavedBooks(1, 30),
    enabled: activeTab === 'saved' && !!user,
  });

  const cloudDownloadedBooks = cloudDownloadedData?.books || [];
  const savedBooks = savedData?.books || [];

  // Filter and sort bookshelf books
  const allBooksList = Object.values(bookshelfBooks);
  const filteredBooks = allBooksList.filter((b) => {
    if (filterFormat === 'all') return true;
    return b.extension.toLowerCase() === filterFormat;
  });

  const sortedBooks = [...filteredBooks].sort((a, b) => {
    if (sortBy === 'recent') {
      return (b.lastReadTime || 0) - (a.lastReadTime || 0);
    }
    if (sortBy === 'progress') {
      return (b.progress || 0) - (a.progress || 0);
    }
    if (sortBy === 'dateAdded') {
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title, 'zh-CN');
    }
    return 0;
  });

  const completedCount = allBooksList.filter((b) => b.progress >= 99).length;

  // Handle local book import
  const handleImportBook = async () => {
    try {
      setImportLoading(true);
      const file = await pickLocalBookFile();
      if (!file) {
        setImportLoading(false);
        return;
      }

      const newBook = await importLocalBook(file.name, file.uri, file.size);
      
      // Auto switch to bookshelf tab, clear filter, and sort by recent
      setActiveTab('bookshelf');
      setFilterFormat('all');
      setSortBy('recent');
      setImportedNotice(newBook);
      setImportLoading(false);

      // Auto dismiss notice after 8 seconds
      setTimeout(() => {
        setImportedNotice((cur) => (cur?.id === newBook.id ? null : cur));
      }, 8000);
    } catch (e: any) {
      setImportLoading(false);
      Alert.alert('导入失败', e.message || '选取文件出错');
    }
  };

  const handleBookOptions = (book: BookshelfItem) => {
    const options = ['开始阅读', '分享文件', '从书架移除', '取消'];
    const destructiveIndex = 2;
    const cancelIndex = 3;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: destructiveIndex,
          cancelButtonIndex: cancelIndex,
          title: book.title,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) openReader(book);
          if (buttonIndex === 1 && book.localUri) Sharing.shareAsync(book.localUri);
          if (buttonIndex === 2) removeBook(book.id);
        }
      );
    } else {
      Alert.alert(book.title, '选择操作', [
        { text: '开始阅读', onPress: () => openReader(book) },
        {
          text: '分享文件',
          onPress: () => {
            if (book.localUri) Sharing.shareAsync(book.localUri);
          },
        },
        {
          text: '从书架移除',
          style: 'destructive',
          onPress: () => removeBook(book.id),
        },
        { text: '取消', style: 'cancel' },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleArea}>
          <Text style={styles.headerTitle}>书架与借阅</Text>
          <Text style={styles.headerSubtitle}>
            共 {allBooksList.length} 本图书 · 已读完 {completedCount} 本
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            style={styles.actionBtn}
            onPress={handleImportBook}
            disabled={importLoading}>
            {importLoading ? (
              <ActivityIndicator size="small" color="#38bdf8" />
            ) : (
              <Plus size={16} color="#38bdf8" />
            )}
            <Text style={styles.actionBtnText}>
              {importLoading ? '导入中...' : '导入'}
            </Text>
          </Pressable>

          {activeTab === 'bookshelf' ? (
            <Pressable
              style={styles.iconBtn}
              onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
              {viewMode === 'grid' ? (
                <ListIcon size={18} color="#94a3b8" />
              ) : (
                <LayoutGrid size={18} color="#94a3b8" />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tabBtn, activeTab === 'bookshelf' && styles.tabBtnActive]}
          onPress={() => setActiveTab('bookshelf')}>
          <Library size={13} color={activeTab === 'bookshelf' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.tabText, activeTab === 'bookshelf' && styles.tabTextActive]}>
            我的书架 ({allBooksList.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabBtn, activeTab === 'cloud_downloaded' && styles.tabBtnActive]}
          onPress={() => setActiveTab('cloud_downloaded')}>
          <History size={13} color={activeTab === 'cloud_downloaded' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.tabText, activeTab === 'cloud_downloaded' && styles.tabTextActive]}>
            云端下载
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabBtn, activeTab === 'saved' && styles.tabBtnActive]}
          onPress={() => setActiveTab('saved')}>
          <Bookmark size={13} color={activeTab === 'saved' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.tabText, activeTab === 'saved' && styles.tabTextActive]}>
            线上收藏
          </Text>
        </Pressable>
      </View>

      {/* In-App Import Success Banner */}
      {importedNotice ? (
        <View style={styles.importedBanner}>
          <View style={styles.importedBannerLeft}>
            <CheckCircle size={18} color="#10b981" />
            <Text style={styles.importedBannerText} numberOfLines={1}>
              已成功导入《{importedNotice.title}》
            </Text>
          </View>
          <View style={styles.importedBannerActions}>
            <Pressable
              style={styles.importedReadBtn}
              onPress={() => {
                openReader(importedNotice);
                setImportedNotice(null);
              }}>
              <Text style={styles.importedReadBtnText}>立即阅读</Text>
            </Pressable>
            <Pressable
              style={styles.importedCloseBtn}
              onPress={() => setImportedNotice(null)}>
              <Text style={styles.importedCloseText}>✕</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Bookshelf Tab Content */}
      {activeTab === 'bookshelf' ? (
        <View style={styles.contentContainer}>
          {/* Filter & Sort Bar */}
          <View style={styles.filterBar}>
            <View style={styles.formatChips}>
              {(['all', 'epub', 'txt', 'pdf'] as const).map((fmt) => (
                <Pressable
                  key={fmt}
                  style={[
                    styles.chip,
                    filterFormat === fmt && styles.chipActive,
                  ]}
                  onPress={() => setFilterFormat(fmt)}>
                  <Text
                    style={[
                      styles.chipText,
                      filterFormat === fmt && styles.chipTextActive,
                    ]}>
                    {fmt === 'all' ? '全部' : fmt.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Sort Selector */}
            <Pressable
              style={styles.sortBtn}
              onPress={() => {
                const sorts: ('recent' | 'progress' | 'title' | 'dateAdded')[] = [
                  'recent',
                  'progress',
                  'dateAdded',
                  'title',
                ];
                const nextIdx = (sorts.indexOf(sortBy) + 1) % sorts.length;
                setSortBy(sorts[nextIdx]);
              }}>
              <Text style={styles.sortBtnText}>
                {sortBy === 'recent'
                  ? '最近阅读'
                  : sortBy === 'progress'
                  ? '阅读进度'
                  : sortBy === 'dateAdded'
                  ? '添加时间'
                  : '书名排序'}
              </Text>
            </Pressable>
          </View>

          {/* Book List / Grid */}
          {sortedBooks.length === 0 ? (
            <View style={styles.centerBox}>
              <Library size={48} color="#334155" />
              <Text style={styles.emptyTitle}>书架空空如也</Text>
              <Text style={styles.emptySubtitle}>
                你可以点击右上角「+ 导入」本地 EPUB/TXT/PDF，或在「发现」「搜索」中下载图书
              </Text>
              <Pressable
                style={styles.importEmptyBtn}
                onPress={handleImportBook}
                disabled={importLoading}>
                {importLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Plus size={16} color="#fff" />
                )}
                <Text style={styles.importEmptyBtnText}>
                  {importLoading ? '正在选择文件...' : '导入本地图书 (PDF/EPUB/TXT)'}
                </Text>
              </Pressable>
            </View>
          ) : viewMode === 'grid' ? (
            /* NeatReader Grid View */
            <FlatList
              key="grid-view"
              data={sortedBooks}
              numColumns={2}
              keyExtractor={(item) => `shelf-grid-${item.id}`}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => {
                const isPdf = item.extension.toLowerCase() === 'pdf';
                return (
                  <Pressable
                    style={styles.gridCard}
                    onPress={() => openReader(item)}
                    onLongPress={() => handleBookOptions(item)}>
                    <View style={styles.gridCoverWrapper}>
                      {item.cover ? (
                        <Image
                          source={{ uri: item.cover }}
                          style={styles.gridCover}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          style={[
                            styles.gridCoverFallback,
                            isPdf && styles.pdfCoverFallback,
                          ]}>
                          {isPdf ? (
                            <FileText size={36} color="#ef4444" />
                          ) : (
                            <BookOpen size={32} color="#64748b" />
                          )}
                          <Text
                            style={[
                              styles.gridCoverFallbackTitle,
                              isPdf && { color: '#f87171' },
                            ]}
                            numberOfLines={2}>
                            {item.title}
                          </Text>
                        </View>
                      )}

                      {/* Format Badge */}
                      <View
                        style={[
                          styles.gridFormatBadge,
                          item.extension === 'pdf'
                            ? styles.pdfBadge
                            : item.extension === 'txt'
                            ? styles.txtBadge
                            : styles.epubBadge,
                        ]}>
                        <Text style={styles.gridFormatText}>
                          {item.extension.toUpperCase()}
                        </Text>
                      </View>

                      {/* Progress Bar Over Cover */}
                      <View style={styles.gridProgressContainer}>
                        <View
                          style={[
                            styles.gridProgressFill,
                            { width: `${Math.min(100, Math.max(0, item.progress))}%` },
                          ]}
                        />
                      </View>
                    </View>

                    <View style={styles.gridInfo}>
                      <Text style={styles.gridTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View style={styles.gridBottomRow}>
                        <Text style={styles.gridProgressText}>
                          {item.progress >= 99 ? (
                            <Text style={{ color: '#10b981' }}>已读完</Text>
                          ) : item.progress > 0 ? (
                            `${item.progress.toFixed(0)}%`
                          ) : (
                            '未读'
                          )}
                        </Text>
                        <Pressable
                          style={styles.gridMoreBtn}
                          onPress={() => handleBookOptions(item)}>
                          <MoreVertical size={14} color="#64748b" />
                        </Pressable>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
            />
          ) : (
            /* NeatReader Detailed List View */
            <FlatList
              key="list-view"
              data={sortedBooks}
              keyExtractor={(item) => `shelf-list-${item.id}`}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isPdf = item.extension.toLowerCase() === 'pdf';
                return (
                  <Pressable
                    style={styles.localCard}
                    onPress={() => openReader(item)}
                    onLongPress={() => handleBookOptions(item)}>
                    <View style={styles.listCoverWrapper}>
                      {item.cover ? (
                        <Image
                          source={{ uri: item.cover }}
                          style={styles.localCover}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          style={[
                            styles.localCover,
                            styles.gridCoverFallback,
                            isPdf && styles.pdfCoverFallback,
                          ]}>
                          {isPdf ? (
                            <FileText size={22} color="#ef4444" />
                          ) : (
                            <BookOpen size={20} color="#64748b" />
                          )}
                        </View>
                      )}
                    </View>

                    <View style={styles.localInfo}>
                      <Text style={styles.localTitle} numberOfLines={2}>
                        {item.title}
                      </Text>

                      <Text style={styles.localAuthor} numberOfLines={1}>
                        {item.author || '未知作者'}
                      </Text>

                      {/* Progress Bar */}
                      <View style={styles.listProgressBar}>
                        <View
                          style={[
                            styles.listProgressFill,
                            { width: `${Math.min(100, Math.max(0, item.progress))}%` },
                          ]}
                        />
                      </View>

                      <View style={styles.localMeta}>
                        <View
                          style={[
                            styles.extBadge,
                            item.extension === 'pdf'
                              ? styles.pdfBadge
                              : item.extension === 'txt'
                              ? styles.txtBadge
                              : styles.epubBadge,
                          ]}>
                          <Text style={styles.extText}>{item.extension.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.localSize}>
                          {item.progress >= 99 ? '已读完' : `已读 ${item.progress.toFixed(0)}%`}
                        </Text>
                        {item.filesizeString ? (
                          <Text style={styles.localSize}>{item.filesizeString}</Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.openBtn}>
                      <BookOpen size={14} color="#38bdf8" />
                      <Text style={styles.openBtnText}>阅读</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      ) : activeTab === 'cloud_downloaded' ? (
        !user ? (
          <View style={styles.centerBox}>
            <History size={48} color="#334155" />
            <Text style={styles.emptyTitle}>尚未登录账号</Text>
            <Text style={styles.emptySubtitle}>
              在「我的」页面登录 Z-Library 账号后，即可在此查看该账号在所有设备上下载过的所有历史书籍。
            </Text>
          </View>
        ) : isLoadingCloudDl ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text style={styles.loadingText}>正在从云端同步账号下载历史...</Text>
          </View>
        ) : (
          <FlatList
            data={cloudDownloadedBooks}
            keyExtractor={(item) => `cloud-dl-${item.id}-${item.hash}`}
            renderItem={({ item }) => <BookCard book={item} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.centerBox}>
                <Text style={styles.emptySubtitle}>该账号暂无云端下载记录</Text>
              </View>
            }
          />
        )
      ) : (
        /* Saved / Favorites */
        !user ? (
          <View style={styles.centerBox}>
            <Bookmark size={48} color="#334155" />
            <Text style={styles.emptyTitle}>尚未登录账号</Text>
            <Text style={styles.emptySubtitle}>登录 Z-Library 账号后即可同步云端收藏夹</Text>
          </View>
        ) : isLoadingSaved ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text style={styles.loadingText}>正在同步收藏夹...</Text>
          </View>
        ) : (
          <FlatList
            data={savedBooks}
            keyExtractor={(item) => `saved-${item.id}-${item.hash}`}
            renderItem={({ item }) => <BookCard book={item} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.centerBox}>
                <Text style={styles.emptySubtitle}>云端收藏夹为空</Text>
              </View>
            }
          />
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  contentContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerTitleArea: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  iconBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 3,
    marginTop: 8,
    marginBottom: 8,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#0284c7',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  importedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
  },
  importedBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
  },
  importedBannerText: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  importedBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  importedReadBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  importedReadBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  importedCloseBtn: {
    padding: 4,
  },
  importedCloseText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  filterBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  formatChips: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#1e293b',
  },
  chipActive: {
    backgroundColor: '#0284c7',
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  sortBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#1e293b',
  },
  sortBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  gridContent: {
    paddingHorizontal: 10,
    paddingBottom: 90,
  },
  gridCard: {
    flex: 1,
    margin: 6,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  gridCoverWrapper: {
    width: '100%',
    aspectRatio: 0.72,
    position: 'relative',
    backgroundColor: '#334155',
  },
  gridCover: {
    width: '100%',
    height: '100%',
  },
  gridCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#1e293b',
  },
  pdfCoverFallback: {
    backgroundColor: '#2d1517',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  gridCoverFallbackTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  gridFormatBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  epubBadge: {
    backgroundColor: '#0284c7',
  },
  txtBadge: {
    backgroundColor: '#8b5cf6',
  },
  pdfBadge: {
    backgroundColor: '#ef4444',
  },
  gridFormatText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  gridProgressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  gridProgressFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  gridInfo: {
    padding: 10,
  },
  gridTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    minHeight: 36,
  },
  gridBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  gridProgressText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  gridMoreBtn: {
    padding: 4,
  },
  listContent: {
    paddingBottom: 90,
  },
  localCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    marginHorizontal: 16,
    marginVertical: 5,
    padding: 12,
    borderRadius: 12,
  },
  listCoverWrapper: {
    position: 'relative',
  },
  localCover: {
    width: 52,
    height: 74,
    borderRadius: 6,
    backgroundColor: '#334155',
  },
  localInfo: {
    flex: 1,
    marginLeft: 12,
  },
  localTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  localAuthor: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  listProgressBar: {
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 4,
  },
  listProgressFill: {
    height: '100%',
    backgroundColor: '#0284c7',
  },
  localMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  extBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  extText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  localSize: {
    color: '#64748b',
    fontSize: 11,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  openBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  importEmptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0284c7',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 20,
  },
  importEmptyBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
});
