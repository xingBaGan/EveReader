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
import { useRouter } from 'expo-router';
import { zlibApi } from '../api/endpoints';
import { BookCard } from '../components/BookCard';
import { useDomainStore } from '../stores/useDomainStore';
import { useAuthStore } from '../stores/useAuthStore';
import { Globe, Flame, Sparkles, RefreshCw, LogIn } from 'lucide-react-native';

export default function HomeScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'popular' | 'recommended'>('popular');
  const currentBaseUrl = useDomainStore((s) => s.currentBaseUrl);
  const isProbing = useDomainStore((s) => s.isProbing);
  const probeFastestDomain = useDomainStore((s) => s.probeFastestDomain);
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['books', tab, currentBaseUrl, user?.id],
    queryFn: () => (tab === 'popular' ? zlibApi.getMostPopular(1) : zlibApi.getRecommendations()),
    enabled: tab === 'popular' || !!user,
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
          <Flame size={14} color={tab === 'popular' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.segmentText, tab === 'popular' && styles.segmentTextActive]}>
            最受欢迎
          </Text>
        </Pressable>

        <Pressable
          style={[styles.segmentBtn, tab === 'recommended' && styles.segmentBtnActive]}
          onPress={() => setTab('recommended')}>
          <Sparkles size={14} color={tab === 'recommended' ? '#fff' : '#94a3b8'} />
          <Text style={[styles.segmentText, tab === 'recommended' && styles.segmentTextActive]}>
            为你推荐
          </Text>
        </Pressable>
      </View>

      {/* Book List / Not Logged In State for Recommendations */}
      {tab === 'recommended' && !user ? (
        <View style={styles.centerBox}>
          <Sparkles size={48} color="#334155" />
          <Text style={styles.emptyTitle}>登录后开启专属推荐</Text>
          <Text style={styles.emptySubtitle}>
            Z-Library 会根据你的借阅历史、搜索偏好与云端收藏，智能生成个性化推荐书单。
          </Text>
          <Pressable style={styles.loginActionBtn} onPress={() => router.push('/profile')}>
            <LogIn size={16} color="#fff" />
            <Text style={styles.loginActionBtnText}>前往登录账号</Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>
            {tab === 'popular' ? '正在拉取最受欢迎书籍...' : '正在同步个性化推荐书单...'}
          </Text>
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
              <Text style={styles.emptyText}>
                {tab === 'recommended' ? '暂无专属推荐，先多浏览收藏几本书吧' : '暂无书籍记录'}
              </Text>
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
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
    textAlign: 'center',
  },
  loginActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 18,
  },
  loginActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
