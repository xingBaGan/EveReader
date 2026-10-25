import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Heart,
  Share2,
  Download,
  BookOpen,
  Send,
  Mail,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookMarked,
  Check,
  ExternalLink,
} from 'lucide-react-native';

import { ZLibBook, ZLibFormat } from '../../types/zlib';
import { useBookDetailStore } from '../../stores/useBookDetailStore';
import { useDownloadStore } from '../../stores/useDownloadStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { zlibApi } from '../../api/endpoints';
import { useTheme } from '../../hooks/use-theme';
import { Elevation, Shape, Spacing, Typography } from '../../constants/theme';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Card } from '../ui/card';

function stripHtml(html?: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function BookDetailModal() {
  const theme = useTheme();
  const isOpen = useBookDetailStore((s) => s.isOpen);
  const rawBook = useBookDetailStore((s) => s.book);
  const closeBookDetail = useBookDetailStore((s) => s.closeBookDetail);
  const openBookDetail = useBookDetailStore((s) => s.openBookDetail);

  const [activeBook, setActiveBook] = useState<ZLibBook | null>(null);
  const [detailData, setDetailData] = useState<ZLibBook | null>(null);
  const [formats, setFormats] = useState<ZLibFormat[]>([]);
  const [similarBooks, setSimilarBooks] = useState<ZLibBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const currentBookId = activeBook?.id || rawBook?.id;
  const currentHash = activeBook?.hash || rawBook?.hash;

  const task = useDownloadStore((s) => (currentBookId ? s.tasks[currentBookId] : undefined));
  const startDownload = useDownloadStore((s) => s.startDownload);
  const openBookInReader = useDownloadStore((s) => s.openBookInReader);
  const openFileWithExternalReader = useDownloadStore((s) => s.openFileWithExternalReader);

  const isDownloading = task?.status === 'downloading';
  const isCompleted = task?.status === 'completed';

  // Sync state when rawBook changes
  useEffect(() => {
    if (rawBook) {
      setActiveBook(rawBook);
      setDetailData(null);
      setFormats([]);
      setSimilarBooks([]);
      setIsSaved(!!rawBook.isUserSavedBook);
      setIsDescExpanded(false);
    }
  }, [rawBook]);

  // Fetch full details, formats, and similar recommendations
  useEffect(() => {
    if (!isOpen || !currentBookId || !currentHash) return;

    let isMounted = true;
    setLoading(true);

    Promise.allSettled([
      zlibApi.getBookDetail(currentBookId, currentHash),
      zlibApi.getBookFormats(currentBookId, currentHash),
      zlibApi.getSimilarBooks(currentBookId, currentHash),
    ]).then(([detailRes, formatsRes, similarRes]) => {
      if (!isMounted) return;

      if (detailRes.status === 'fulfilled' && detailRes.value.book) {
        setDetailData(detailRes.value.book);
        if (detailRes.value.book.isUserSavedBook !== undefined) {
          setIsSaved(!!detailRes.value.book.isUserSavedBook);
        }
      }

      if (formatsRes.status === 'fulfilled') {
        const val = formatsRes.value;
        const availableFormats = val.formats || (val.books as any) || [];
        setFormats(availableFormats);
      }

      if (similarRes.status === 'fulfilled' && Array.isArray(similarRes.value.books)) {
        setSimilarBooks(similarRes.value.books);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentBookId, currentHash]);

  const displayBook = detailData || activeBook || rawBook;
  if (!isOpen || !displayBook) return null;

  // Toggle Save to Favorites / Cloud Library
  const handleToggleSave = async () => {
    const user = useAuthStore.getState().user;
    if (!user) {
      Alert.alert(
        '需要登录 Z-Library 账号',
        '收藏书籍需要同步至您的云端账号，请先登录账号。',
        [
          { text: '稍后再说', style: 'cancel' },
          {
            text: '前往登录',
            onPress: () => {
              closeBookDetail();
            },
          },
        ]
      );
      return;
    }

    try {
      setIsSaving(true);
      if (isSaved) {
        await zlibApi.unsaveBook(displayBook.id);
        setIsSaved(false);
      } else {
        await zlibApi.saveBook(displayBook.id);
        setIsSaved(true);
      }
    } catch (err: any) {
      Alert.alert('操作失败', err.response?.data?.error || err.message || '请检查网络连接');
    } finally {
      setIsSaving(false);
    }
  };

  // Share book info
  const handleShare = async () => {
    try {
      await Share.share({
        title: displayBook.title,
        message: `《${displayBook.title}》- ${displayBook.author || 'Z-Library'} [${displayBook.extension?.toUpperCase() || 'BOOK'}]`,
      });
    } catch (e) {
      // ignore
    }
  };

  // Push to Email or Kindle
  const handleSendTo = (type: 'email' | 'kindle') => {
    const user = useAuthStore.getState().user;
    if (!user) {
      Alert.alert('需要登录', '推送书籍需要登录 Z-Library 账号，请在「我的」登录后重试。');
      return;
    }

    const typeLabel = type === 'email' ? '邮箱' : 'Kindle 设备';
    Alert.alert(
      `推送到 ${typeLabel}`,
      `确认将《${displayBook.title}》推送到您绑定的 ${typeLabel} 吗？这同样会消耗您当日的下载配额。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认推送',
          onPress: async () => {
            try {
              const res = await zlibApi.sendBookTo(displayBook.id, displayBook.hash, type);
              if (res.success) {
                Alert.alert('推送成功', `已成功将书籍发送至您的 ${typeLabel}，请注意查收。`);
              } else {
                Alert.alert('推送失败', res.error || '服务器处理超时，请稍后重试');
              }
            } catch (err: any) {
              Alert.alert('推送失败', err.response?.data?.error || err.message || '请求失败');
            }
          },
        },
      ]
    );
  };

  const cleanDescription = stripHtml(displayBook.description);
  const isLongDesc = cleanDescription.length > 180;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeBookDetail}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.surface }]}
        edges={['top']}>
        {/* Top Header Bar */}
        <View style={[styles.header, { borderBottomColor: theme.outlineVariant }]}>
          <Pressable
            style={[styles.iconButton, { backgroundColor: theme.surfaceContainerHigh }]}
            onPress={closeBookDetail}
            hitSlop={12}>
            <X size={20} color={theme.onSurface} />
          </Pressable>

          <Text
            style={[Typography.titleMedium, styles.headerTitle, { color: theme.onSurface }]}
            numberOfLines={1}>
            书籍详情
          </Text>

          <View style={styles.headerRightActions}>
            <Pressable
              style={[styles.iconButton, { backgroundColor: theme.surfaceContainerHigh }]}
              onPress={handleToggleSave}
              disabled={isSaving}
              hitSlop={12}>
              <Heart
                size={18}
                color={isSaved ? theme.error : theme.onSurfaceVariant}
                fill={isSaved ? theme.error : 'none'}
              />
            </Pressable>

            <Pressable
              style={[styles.iconButton, { backgroundColor: theme.surfaceContainerHigh }]}
              onPress={handleShare}
              hitSlop={12}>
              <Share2 size={18} color={theme.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {/* Hero Section: Cover + Basic Meta */}
          <View style={styles.heroSection}>
            <View
              style={[
                styles.coverWrapper,
                { backgroundColor: theme.surfaceContainerHighest, ...Elevation.level3 },
              ]}>
              <Image
                source={{ uri: displayBook.cover }}
                style={styles.coverImage}
                contentFit="cover"
                transition={250}
              />
            </View>

            <View style={styles.heroMeta}>
              <Text
                style={[Typography.headlineSmall, styles.bookTitle, { color: theme.onSurface }]}
                selectable>
                {displayBook.title}
              </Text>

              <Text
                style={[Typography.titleMedium, styles.bookAuthor, { color: theme.primary }]}
                selectable>
                {displayBook.author || '未知作者'}
              </Text>

              {displayBook.publisher ? (
                <Text
                  style={[Typography.bodySmall, { color: theme.onSurfaceVariant, marginTop: 4 }]}
                  numberOfLines={1}>
                  出版社: {displayBook.publisher}
                </Text>
              ) : null}

              {/* Tag Chips Row */}
              <View style={styles.tagChips}>
                <Chip
                  variant="badge"
                  colorRole="primary"
                  label={displayBook.extension?.toUpperCase() || 'BOOK'}
                />
                {displayBook.filesizeString ? (
                  <Chip
                    variant="badge"
                    colorRole="surface"
                    label={displayBook.filesizeString}
                  />
                ) : null}
                {displayBook.year ? (
                  <Chip
                    variant="badge"
                    colorRole="surface"
                    label={`${displayBook.year}年`}
                  />
                ) : null}
                {displayBook.language ? (
                  <Chip
                    variant="badge"
                    colorRole="surface"
                    label={displayBook.language}
                  />
                ) : null}
              </View>
            </View>
          </View>

          {/* Available Formats Selector (from /formats) */}
          {formats.length > 0 && (
            <View style={[styles.section, { borderTopColor: theme.outlineVariant }]}>
              <Text style={[Typography.titleMedium, styles.sectionTitle, { color: theme.onSurface }]}>
                可用格式与版本切换
              </Text>
              <View style={styles.formatChipsRow}>
                {formats.map((fmt, idx) => {
                  const isCurrent =
                    fmt.id === displayBook.id ||
                    fmt.extension?.toLowerCase() === displayBook.extension?.toLowerCase();
                  return (
                    <Pressable
                      key={`${fmt.id || idx}-${fmt.extension}`}
                      style={[
                        styles.formatChip,
                        {
                          backgroundColor: isCurrent
                            ? theme.primaryContainer
                            : theme.surfaceContainerHigh,
                          borderColor: isCurrent ? theme.primary : theme.outlineVariant,
                        },
                      ]}
                      onPress={() => {
                        if (fmt.id && fmt.hash) {
                          setActiveBook({
                            ...displayBook,
                            id: fmt.id,
                            hash: fmt.hash,
                            extension: fmt.extension,
                            filesizeString: fmt.filesizeString || displayBook.filesizeString,
                          });
                        }
                      }}>
                      <Text
                        style={[
                          Typography.labelMedium,
                          {
                            color: isCurrent ? theme.onPrimaryContainer : theme.onSurface,
                            fontWeight: isCurrent ? '700' : '500',
                          },
                        ]}>
                        {fmt.extension?.toUpperCase()}
                      </Text>
                      {fmt.filesizeString ? (
                        <Text
                          style={[
                            Typography.bodySmall,
                            {
                              color: isCurrent
                                ? theme.onPrimaryContainer
                                : theme.onSurfaceVariant,
                              fontSize: 11,
                              marginLeft: 4,
                            },
                          ]}>
                          {fmt.filesizeString}
                        </Text>
                      ) : null}
                      {isCurrent && <Check size={14} color={theme.primary} style={{ marginLeft: 4 }} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Book Synopsis / Description */}
          <View style={[styles.section, { borderTopColor: theme.outlineVariant }]}>
            <Text style={[Typography.titleMedium, styles.sectionTitle, { color: theme.onSurface }]}>
              内容简介
            </Text>

            {loading && !cleanDescription ? (
              <ActivityIndicator
                size="small"
                color={theme.primary}
                style={{ alignSelf: 'flex-start', marginVertical: 8 }}
              />
            ) : cleanDescription ? (
              <View>
                <Text
                  style={[
                    Typography.bodyMedium,
                    styles.descriptionText,
                    { color: theme.onSurfaceVariant },
                  ]}
                  numberOfLines={isLongDesc && !isDescExpanded ? 5 : undefined}
                  selectable>
                  {cleanDescription}
                </Text>
                {isLongDesc && (
                  <Pressable
                    style={styles.expandToggle}
                    onPress={() => setIsDescExpanded(!isDescExpanded)}>
                    <Text style={[Typography.labelLarge, { color: theme.primary, fontWeight: '600' }]}>
                      {isDescExpanded ? '收起' : '展开全文'}
                    </Text>
                    {isDescExpanded ? (
                      <ChevronUp size={16} color={theme.primary} />
                    ) : (
                      <ChevronDown size={16} color={theme.primary} />
                    )}
                  </Pressable>
                )}
              </View>
            ) : (
              <Text style={[Typography.bodyMedium, { color: theme.onSurfaceVariant, fontStyle: 'italic' }]}>
                暂无该书籍的简介说明。
              </Text>
            )}
          </View>

          {/* Metadata Grid Table */}
          <View style={[styles.section, { borderTopColor: theme.outlineVariant }]}>
            <Text style={[Typography.titleMedium, styles.sectionTitle, { color: theme.onSurface }]}>
              详细信息
            </Text>

            <View style={[styles.metaTable, { backgroundColor: theme.surfaceContainerLow }]}>
              {displayBook.identifier ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    ISBN / 标识符
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]} selectable>
                    {displayBook.identifier}
                  </Text>
                </View>
              ) : null}

              {displayBook.publisher ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    出版社
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]} selectable>
                    {displayBook.publisher}
                  </Text>
                </View>
              ) : null}

              {displayBook.year ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    出版年份
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]}>
                    {displayBook.year}
                  </Text>
                </View>
              ) : null}

              {displayBook.language ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    语言
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]}>
                    {displayBook.language}
                  </Text>
                </View>
              ) : null}

              {displayBook.pages ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    页数
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]}>
                    {displayBook.pages} 页
                  </Text>
                </View>
              ) : null}

              {displayBook.series ? (
                <View style={styles.metaRow}>
                  <Text style={[Typography.labelMedium, styles.metaLabel, { color: theme.onSurfaceVariant }]}>
                    系列丛书
                  </Text>
                  <Text style={[Typography.bodyMedium, styles.metaValue, { color: theme.onSurface }]}>
                    {displayBook.series}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Similar Books (Similar Recommendations) */}
          {similarBooks.length > 0 && (
            <View style={[styles.section, { borderTopColor: theme.outlineVariant }]}>
              <View style={styles.sectionHeaderRow}>
                <Sparkles size={16} color={theme.primary} />
                <Text style={[Typography.titleMedium, styles.sectionTitle, { color: theme.onSurface }]}>
                  相关书籍推荐
                </Text>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.similarScroll}>
                {similarBooks.map((simBook) => (
                  <Pressable
                    key={`${simBook.id}-${simBook.hash}`}
                    style={[
                      styles.similarCard,
                      { backgroundColor: theme.surfaceContainerLow, ...Elevation.level1 },
                    ]}
                    onPress={() => openBookDetail(simBook)}>
                    <Image
                      source={{ uri: simBook.cover }}
                      style={styles.similarCover}
                      contentFit="cover"
                      transition={200}
                    />
                    <Text
                      style={[Typography.bodySmall, styles.similarTitle, { color: theme.onSurface }]}
                      numberOfLines={2}>
                      {simBook.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky Bottom Action Bar */}
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: theme.surfaceContainer,
              borderTopColor: theme.outlineVariant,
              ...Elevation.level2,
            },
          ]}>
          <View style={styles.bottomSecondaryActions}>
            <Pressable
              style={[styles.smallActionBtn, { backgroundColor: theme.surfaceContainerHigh }]}
              onPress={() => handleSendTo('kindle')}
              hitSlop={8}>
              <Send size={16} color={theme.onSurfaceVariant} />
              <Text style={[Typography.labelSmall, { color: theme.onSurfaceVariant, marginTop: 2 }]}>
                Kindle
              </Text>
            </Pressable>

            <Pressable
              style={[styles.smallActionBtn, { backgroundColor: theme.surfaceContainerHigh }]}
              onPress={() => handleSendTo('email')}
              hitSlop={8}>
              <Mail size={16} color={theme.onSurfaceVariant} />
              <Text style={[Typography.labelSmall, { color: theme.onSurfaceVariant, marginTop: 2 }]}>
                邮箱
              </Text>
            </Pressable>
          </View>

          <View style={styles.bottomPrimaryAction}>
            {isDownloading ? (
              <Button
                variant="tonal"
                size="large"
                disabled
                title={`正在下载 ${task?.progress || 0}%...`}
                icon={<ActivityIndicator size="small" color={theme.primary} />}
                style={{ flex: 1 }}
              />
            ) : isCompleted ? (
              <View style={styles.completedActionRow}>
                <Button
                  variant="filled"
                  size="large"
                  onPress={() => {
                    closeBookDetail();
                    openBookInReader(displayBook.id);
                  }}
                  title="立即阅读"
                  icon={<BookOpen size={18} color={theme.onPrimary} />}
                  style={{ flex: 1 }}
                />
                <Pressable
                  style={[styles.externalOpenBtn, { backgroundColor: theme.surfaceContainerHigh }]}
                  onPress={() => openFileWithExternalReader(displayBook.id)}>
                  <ExternalLink size={18} color={theme.onSurface} />
                </Pressable>
              </View>
            ) : (
              <Button
                variant="filled"
                size="large"
                onPress={() => startDownload(displayBook)}
                title={`下载书籍 (${displayBook.extension?.toUpperCase() || 'BOOK'} · ${displayBook.filesizeString || '未知大小'})`}
                icon={<Download size={18} color={theme.onPrimary} />}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.medium,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.small,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.small,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.large,
  },
  heroSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.medium,
  },
  coverWrapper: {
    width: 110,
    height: 160,
    borderRadius: Shape.medium,
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  heroMeta: {
    flex: 1,
  },
  bookTitle: {
    fontWeight: '800',
    lineHeight: 28,
  },
  bookAuthor: {
    marginTop: Spacing.extraSmall,
    fontWeight: '600',
  },
  tagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.extraSmall,
    marginTop: Spacing.small,
  },
  section: {
    marginTop: Spacing.large,
    paddingTop: Spacing.medium,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.extraSmall,
    marginBottom: Spacing.small,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: Spacing.small,
  },
  formatChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.small,
  },
  formatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.medium,
    paddingVertical: Spacing.extraSmall + 2,
    borderRadius: Shape.full,
    borderWidth: 1,
  },
  descriptionText: {
    lineHeight: 22,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.small,
    alignSelf: 'flex-start',
  },
  metaTable: {
    borderRadius: Shape.medium,
    padding: Spacing.medium,
    gap: Spacing.small,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.extraSmall,
  },
  metaLabel: {
    width: 100,
  },
  metaValue: {
    flex: 1,
    textAlign: 'right',
  },
  similarScroll: {
    gap: Spacing.medium,
    paddingVertical: Spacing.extraSmall,
  },
  similarCard: {
    width: 100,
    borderRadius: Shape.small,
    padding: Spacing.extraSmall,
    overflow: 'hidden',
  },
  similarCover: {
    width: '100%',
    height: 135,
    borderRadius: Shape.extraSmall,
  },
  similarTitle: {
    marginTop: Spacing.extraSmall,
    lineHeight: 16,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.large,
    paddingVertical: Spacing.medium,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.medium,
  },
  bottomSecondaryActions: {
    flexDirection: 'row',
    gap: Spacing.small,
  },
  smallActionBtn: {
    width: 48,
    height: 48,
    borderRadius: Shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomPrimaryAction: {
    flex: 1,
  },
  completedActionRow: {
    flexDirection: 'row',
    gap: Spacing.small,
    alignItems: 'center',
  },
  externalOpenBtn: {
    width: 48,
    height: 48,
    borderRadius: Shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
