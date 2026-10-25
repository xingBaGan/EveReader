import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { zlibApi } from '../api/endpoints';
import { BookCard } from '../components/BookCard';
import { Search as SearchIcon, X, SlidersHorizontal } from 'lucide-react-native';

export default function SearchScreen() {
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['searchBooks', submittedKeyword, selectedFormat, selectedLanguage],
    queryFn: () =>
      zlibApi.searchBooks({
        message: submittedKeyword,
        page: 1,
        limit: 20,
        extensions: selectedFormat ? [selectedFormat] : undefined,
        languages: selectedLanguage ? [selectedLanguage] : undefined,
      }),
    enabled: !!submittedKeyword.trim(),
    staleTime: 1000 * 60 * 5,
  });

  const handleSearch = () => {
    if (keyword.trim()) {
      setSubmittedKeyword(keyword.trim());
    }
  };

  const books = data?.books || [];
  const totalCount = data?.exactBooksCount || data?.pagination?.totalItems;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Search Input Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.inputWrapper}>
          <SearchIcon size={16} color="#94a3b8" />
          <TextInput
            style={styles.input}
            placeholder="搜索书名、作者、ISBN 或主题..."
            placeholderTextColor="#64748b"
            value={keyword}
            onChangeText={setKeyword}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {keyword ? (
            <Pressable onPress={() => setKeyword('')}>
              <X size={16} color="#94a3b8" />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>搜索</Text>
        </Pressable>
      </View>

      {/* Quick Filters */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>格式:</Text>
        {['epub', 'pdf', 'mobi'].map((fmt) => (
          <Pressable
            key={fmt}
            style={[styles.filterChip, selectedFormat === fmt && styles.filterChipActive]}
            onPress={() => setSelectedFormat(selectedFormat === fmt ? '' : fmt)}>
            <Text
              style={[
                styles.filterChipText,
                selectedFormat === fmt && styles.filterChipTextActive,
              ]}>
              {fmt.toUpperCase()}
            </Text>
          </Pressable>
        ))}

        <Text style={[styles.filterLabel, { marginLeft: 12 }]}>语言:</Text>
        {[
          { key: 'chinese', label: '中文' },
          { key: 'english', label: '英文' },
        ].map((lang) => (
          <Pressable
            key={lang.key}
            style={[styles.filterChip, selectedLanguage === lang.key && styles.filterChipActive]}
            onPress={() =>
              setSelectedLanguage(selectedLanguage === lang.key ? '' : lang.key)
            }>
            <Text
              style={[
                styles.filterChipText,
                selectedLanguage === lang.key && styles.filterChipTextActive,
              ]}>
              {lang.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Result Status */}
      {submittedKeyword && (
        <View style={styles.statusHeader}>
          <Text style={styles.statusText}>
            “{submittedKeyword}” 的搜索结果
            {totalCount !== undefined ? ` (共 ${totalCount} 本)` : ''}
          </Text>
        </View>
      )}

      {/* Results List */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>正在检索全量书籍索引库...</Text>
        </View>
      ) : isError ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>搜索失败</Text>
          <Text style={styles.errorDetail}>{String((error as any)?.message || error)}</Text>
        </View>
      ) : !submittedKeyword ? (
        <View style={styles.centerBox}>
          <SearchIcon size={48} color="#334155" />
          <Text style={styles.placeholderText}>输入关键词，回车或点击搜索</Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => `${item.id}-${item.hash}`}
          renderItem={({ item }) => <BookCard book={item} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>未找到匹配的书籍，请尝试其他关键词</Text>
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
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
  },
  searchBtn: {
    backgroundColor: '#0284c7',
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  filterLabel: {
    color: '#64748b',
    fontSize: 12,
  },
  filterChip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  filterChipActive: {
    backgroundColor: '#2563eb',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  statusHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 12,
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
  placeholderText: {
    color: '#64748b',
    fontSize: 14,
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
  emptyText: {
    color: '#64748b',
    fontSize: 14,
  },
});
