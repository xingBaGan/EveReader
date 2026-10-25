import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableWithoutFeedback,
} from 'react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';
import { X, Search } from 'lucide-react-native';

interface ReaderSearchModalProps {
  onSearch: (query: string) => void;
  onSelectResult: (cfi: string) => void;
}

export function ReaderSearchModal({ onSearch, onSelectResult }: ReaderSearchModalProps) {
  const [query, setQuery] = useState('');
  const isSearchOpen = useReaderStore((s) => s.isSearchOpen);
  const setIsSearchOpen = useReaderStore((s) => s.setIsSearchOpen);
  const searchResults = useReaderStore((s) => s.searchResults);
  const isSearching = useReaderStore((s) => s.isSearching);
  const settings = useReaderStore((s) => s.settings);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;

  if (!isSearchOpen) return null;

  const handleStartSearch = () => {
    if (!query.trim()) return;
    onSearch(query.trim());
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={isSearchOpen}
      onRequestClose={() => setIsSearchOpen(false)}>
      <TouchableWithoutFeedback onPress={() => setIsSearchOpen(false)}>
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
                <View style={styles.inputWrapper}>
                  <Search size={16} color="#64748b" style={styles.searchIcon} />
                  <TextInput
                    style={[styles.input, { color: themeConfig.barText }]}
                    placeholder="在本书中搜索关键词..."
                    placeholderTextColor="#94a3b8"
                    value={query}
                    onChangeText={setQuery}
                    returnKeyType="search"
                    onSubmitEditing={handleStartSearch}
                    autoFocus
                  />
                  {query ? (
                    <Pressable onPress={() => setQuery('')} style={styles.clearBtn}>
                      <X size={14} color="#64748b" />
                    </Pressable>
                  ) : null}
                </View>

                <Pressable
                  style={[styles.searchBtn, !query.trim() && styles.searchBtnDisabled]}
                  onPress={handleStartSearch}
                  disabled={!query.trim() || isSearching}>
                  {isSearching ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.searchBtnText}>搜索</Text>
                  )}
                </Pressable>

                <Pressable onPress={() => setIsSearchOpen(false)} style={styles.closeBtn}>
                  <X size={20} color={themeConfig.barText} />
                </Pressable>
              </View>

              {/* Results List */}
              {isSearching ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="large" color="#0284c7" />
                  <Text style={[styles.loadingText, { color: themeConfig.barText }]}>
                    正在全书检索 "{query}" ...
                  </Text>
                </View>
              ) : searchResults.length > 0 ? (
                <View style={styles.resultsContainer}>
                  <Text style={styles.resultCount}>找到 {searchResults.length} 处匹配</Text>
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item, idx) => `${item.cfi}-${idx}`}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                      <Pressable
                        style={styles.resultItem}
                        onPress={() => {
                          onSelectResult(item.cfi);
                          setIsSearchOpen(false);
                        }}>
                        <Text
                          style={[styles.resultText, { color: themeConfig.barText }]}
                          numberOfLines={3}>
                          {item.excerpt.trim()}
                        </Text>
                      </Pressable>
                    )}
                  />
                </View>
              ) : query && !isSearching ? (
                <View style={styles.centerBox}>
                  <Text style={[styles.emptyText, { color: themeConfig.barText }]}>
                    未找到包含 "{query}" 的内容
                  </Text>
                </View>
              ) : (
                <View style={styles.centerBox}>
                  <Text style={styles.hintText}>输入关键词后点击“搜索”</Text>
                </View>
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
    justifyContent: 'flex-start',
    paddingTop: 60,
  },
  panel: {
    marginHorizontal: 16,
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  searchIcon: {
    marginRight: 6,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  clearBtn: {
    padding: 4,
  },
  searchBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnDisabled: {
    opacity: 0.5,
  },
  searchBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  resultsContainer: {
    flex: 1,
  },
  resultCount: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 16,
  },
  resultItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.08)',
    marginBottom: 8,
  },
  resultText: {
    fontSize: 13,
    lineHeight: 18,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 10,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 13,
    color: '#64748b',
  },
});
