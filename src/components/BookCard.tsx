import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { ZLibBook } from '../types/zlib';
import { useDownloadStore } from '../stores/useDownloadStore';
import { Download, BookOpen } from 'lucide-react-native';

interface BookCardProps {
  book: ZLibBook;
  onPress?: () => void;
}

export function BookCard({ book, onPress }: BookCardProps) {
  const task = useDownloadStore((s) => s.tasks[book.id]);
  const startDownload = useDownloadStore((s) => s.startDownload);
  const openBookInReader = useDownloadStore((s) => s.openBookInReader);

  const isDownloading = task?.status === 'downloading';
  const isCompleted = task?.status === 'completed';

  const handleAction = async (e: any) => {
    e.stopPropagation();
    if (isCompleted) {
      openBookInReader(book.id);
    } else {
      await startDownload(book);
    }
  };

  const handleCardPress = () => {
    if (onPress) {
      onPress();
    } else if (isCompleted) {
      openBookInReader(book.id);
    } else {
      startDownload(book);
    }
  };

  return (
    <Pressable style={styles.card} onPress={handleCardPress}>
      <Image
        source={{ uri: book.cover }}
        style={styles.cover}
        contentFit="cover"
        transition={200}
      />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {book.author || '未知作者'}
        </Text>

        <View style={styles.tagRow}>
          <View style={[styles.badge, styles.formatBadge]}>
            <Text style={styles.formatText}>{book.extension?.toUpperCase() || 'BOOK'}</Text>
          </View>
          {book.filesizeString ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{book.filesizeString}</Text>
            </View>
          ) : null}
          {book.year ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{book.year}</Text>
            </View>
          ) : null}
          {book.language ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{book.language}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={[
              styles.downloadBtn,
              isCompleted && styles.completedBtn,
              isDownloading && styles.downloadingBtn,
            ]}
            onPress={handleAction}
            disabled={isDownloading}>
            {isDownloading ? (
              <View style={styles.btnContent}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.btnText}>{task?.progress || 0}%</Text>
              </View>
            ) : isCompleted ? (
              <View style={styles.btnContent}>
                <BookOpen size={14} color="#10b981" />
                <Text style={[styles.btnText, { color: '#10b981' }]}>阅读</Text>
              </View>
            ) : (
              <View style={styles.btnContent}>
                <Download size={14} color="#fff" />
                <Text style={styles.btnText}>下载</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  cover: {
    width: 72,
    height: 104,
    borderRadius: 8,
    backgroundColor: '#334155',
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  title: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  author: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  formatBadge: {
    backgroundColor: '#0369a1',
  },
  formatText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeText: {
    color: '#cbd5e1',
    fontSize: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  downloadBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  downloadingBtn: {
    backgroundColor: '#475569',
  },
  completedBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
