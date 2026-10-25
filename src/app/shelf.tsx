import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { zlibApi } from '../api/endpoints';
import { BookCard } from '../components/BookCard';
import { useDownloadStore } from '../stores/useDownloadStore';
import { useAuthStore } from '../stores/useAuthStore';
import { History, Bookmark, HardDrive, ExternalLink } from 'lucide-react-native';

export default function ShelfScreen() {
  const [activeTab, setActiveTab] = useState<'cloud_downloaded' | 'saved' | 'local'>('cloud_downloaded');
  const user = useAuthStore((s) => s.user);
  const tasks = useDownloadStore((s) => s.tasks);
  const openExternal = useDownloadStore((s) => s.openFileWithExternalReader);

  const localDownloadedList = Object.values(tasks).filter((t) => t.status === 'completed');

  // 1. Fetch Cloud Account Download History (/eapi/user/book/downloaded)
  const {
    data: cloudDownloadedData,
    isLoading: isLoadingCloudDl,
    refetch: refetchCloudDl,
  } = useQuery({
    queryKey: ['cloudDownloadedBooks', user?.id],
    queryFn: () => zlibApi.getDownloadedBooks(1, 30),
    enabled: activeTab === 'cloud_downloaded' && !!user,
  });

  // 2. Fetch Cloud Saved / Favorites (/eapi/user/book/saved)
  const {
    data: savedData,
    isLoading: isLoadingSaved,
    refetch: refetchSaved,
  } = useQuery({
    queryKey: ['savedBooks', user?.id],
    queryFn: () => zlibApi.getSavedBooks(1, 30),
    enabled: activeTab === 'saved' && !!user,
  });

  const cloudDownloadedBooks = cloudDownloadedData?.books || [];
  const savedBooks = savedData?.books || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>书架与借阅</Text>
        <Text style={styles.headerSubtitle}>
          {user ? `已连接账号: ${user.name || user.email}` : '登录账号即可同步云端下载记录与收藏'}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tabBtn, activeTab === 'cloud_downloaded' && styles.tabBtnActive]}
          onPress={() => setActiveTab('cloud_downloaded')}>
          <History size={13} color={activeTab === 'cloud_downloaded' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.tabText, activeTab === 'cloud_downloaded' && styles.tabTextActive]}>
            账号下载历史
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

        <Pressable
          style={[styles.tabBtn, activeTab === 'local' && styles.tabBtnActive]}
          onPress={() => setActiveTab('local')}>
          <HardDrive size={13} color={activeTab === 'local' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.tabText, activeTab === 'local' && styles.tabTextActive]}>
            本地离线 ({localDownloadedList.length})
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {activeTab === 'cloud_downloaded' ? (
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
      ) : activeTab === 'saved' ? (
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
      ) : (
        /* Local tab */
        localDownloadedList.length === 0 ? (
          <View style={styles.centerBox}>
            <HardDrive size={48} color="#334155" />
            <Text style={styles.emptyTitle}>暂无本地离线文件</Text>
            <Text style={styles.emptySubtitle}>在本应用中下载完成的图书文件会保存在这里，可直接点击打开</Text>
          </View>
        ) : (
          <FlatList
            data={localDownloadedList}
            keyExtractor={(item) => `local-${item.bookId}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={styles.localCard}
                onPress={() => openExternal(item.bookId)}>
                <Image
                  source={{ uri: item.cover }}
                  style={styles.localCover}
                  contentFit="cover"
                />
                <View style={styles.localInfo}>
                  <Text style={styles.localTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={styles.localMeta}>
                    <View style={styles.extBadge}>
                      <Text style={styles.extText}>{item.extension.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.localSize}>{item.filesizeString}</Text>
                  </View>
                </View>
                <View style={styles.openBtn}>
                  <ExternalLink size={16} color="#38bdf8" />
                  <Text style={styles.openBtnText}>打开</Text>
                </View>
              </Pressable>
            )}
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
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
  listContent: {
    paddingBottom: 80,
  },
  localCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
  },
  localCover: {
    width: 48,
    height: 68,
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
    fontWeight: '600',
    lineHeight: 18,
  },
  localMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  extBadge: {
    backgroundColor: '#2563eb',
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  openBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
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
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
    textAlign: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
});
