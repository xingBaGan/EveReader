import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { zlibApi } from '../api/endpoints';
import { BookCard } from '../components/BookCard';
import { useDomainStore } from '../stores/useDomainStore';
import { useAuthStore } from '../stores/useAuthStore';
import { Globe, Sparkles, Clock, RefreshCw } from 'lucide-react-native';

export default function HomeScreen() {
  const [tab, setTab] = useState<'popular' | 'recent'>('popular');
  const currentBaseUrl = useDomainStore((s) => s.currentBaseUrl);
  const isProbing = useDomainStore((s) => s.isProbing);
  const probeFastestDomain = useDomainStore((s) => s.probeFastestDomain);
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['books', tab, currentBaseUrl],
    queryFn: () => (tab === 'popular' ? zlibApi.getMostPopular(1) : zlibApi.getRecentlyAdded(1)),
    staleTime: 1000 * 60 * 3,
  });

  const books = data?.books || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Z-Library</Text>
          <Text style={styles.headerSubtitle}>
            {user ? `欢迎回来，${user.name || user.email}` : '海量数字图书馆'}
          </Text>
        </View>

        <Pressable
          style={styles.domainBadge}
          onPress={() => probeFastestDomain()}
          disabled={isProbing}>
          <Globe size={12} color="#38bdf8" />
          <Text style={styles.domainText} numberOfLines={1}>
            {currentBaseUrl.replace('https://', '')}
          </Text>
          <RefreshCw size={10} color="#94a3b8" />
        </Pressable>
      </View>

      {/* Segmented Filter */}
      <View style={styles.segmentContainer}>
        <Pressable
          style={[styles.segmentBtn, tab === 'popular' && styles.segmentBtnActive]}
          onPress={() => setTab('popular')}>
          <Sparkles size={14} color={tab === 'popular' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.segmentText, tab === 'popular' && styles.segmentTextActive]}>
            热门借阅
          </Text>
        </Pressable>

        <Pressable
          style={[styles.segmentBtn, tab === 'recent' && styles.segmentBtnActive]}
          onPress={() => setTab('recent')}>
          <Clock size={14} color={tab === 'recent' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.segmentText, tab === 'recent' && styles.segmentTextActive]}>
            最新上架
          </Text>
        </Pressable>
      </View>

      {/* Book List */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>正在从镜像获取书单...</Text>
        </View>
      ) : isError ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>连接当前镜像失败或超时</Text>
          <Text style={styles.errorDetail}>{String((error as any)?.message || error)}</Text>
          <Pressable style={styles.retryBtn} onPress={() => probeFastestDomain()}>
            <Text style={styles.retryBtnText}>切换备用节点并重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => `${item.id}-${item.hash}`}
          renderItem={({ item }) => <BookCard book={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => {
                refetch();
              }}
              tintColor="#38bdf8"
              colors={['#38bdf8']}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>暂无书籍记录</Text>
            </View>
          }
        />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  domainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
    maxWidth: 160,
  },
  domainText: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: '600',
  },
  segmentContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 3,
    marginBottom: 8,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#0284c7',
  },
  segmentText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingBottom: 80,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '600',
  },
  errorDetail: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 16,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
  },
});
