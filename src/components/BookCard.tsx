import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { ZLibBook } from '../types/zlib';
import { useDownloadStore } from '../stores/useDownloadStore';
import { Download, Check, BookOpen } from 'lucide-react-native';

interface BookCardProps {
  book: ZLibBook;
  onPress?: () => void;
}

export function BookCard({ book, onPress }: BookCardProps) {
  const task = useDownloadStore((s) => s.tasks[book.id]);
  const startDownload = useDownloadStore((s) => s.startDownload);
  const openExternal = useDownloadStore((s) => s.openFileWithExternalReader);

  const isDownloading = task?.status === 'downloading';
  const isCompleted = task?.status === 'completed';

  const handleAction = async (e: any) => {
    e.stopPropagation();
    if (isCompleted) {
      await openExternal(book.id);
    } else {
      await startDownload(book);
    }
  };

  return (
    <Pressable style={styles.card} onPress={onPress}>
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
                <Check size={14} color="#10b981" />
                <Text style={[styles.btnText, { color: '#10b981' }]}>已下载</Text>
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
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
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
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
    lineHeight: 20,
  },
  author: {
    fontSize: 13,
    color: '#94a3b8',
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
    backgroundColor: '#2563eb',
  },
  formatText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  badgeText: {
    fontSize: 11,
    color: '#cbd5e1',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  downloadBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  downloadingBtn: {
    backgroundColor: '#0369a1',
  },
  completedBtn: {
    backgroundColor: '#064e3b',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  btnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
