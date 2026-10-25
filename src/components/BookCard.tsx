import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Download, BookOpen, Check } from 'lucide-react-native';

import { ZLibBook } from '../types/zlib';
import { useDownloadStore } from '../stores/useDownloadStore';
import { useBookDetailStore } from '../stores/useBookDetailStore';
import { useTheme } from '../hooks/use-theme';
import { Elevation, Shape, Spacing, Typography } from '../constants/theme';
import { Button } from './ui/button';
import { Chip } from './ui/chip';

interface BookCardProps {
  book: ZLibBook;
  onPress?: () => void;
  variant?: 'elevated' | 'filled' | 'outlined';
}

export function BookCard({ book, onPress, variant = 'elevated' }: BookCardProps) {
  const theme = useTheme();
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
    } else {
      useBookDetailStore.getState().openBookDetail(book);
    }
  };

  // MD3 Card background & elevation according to variant
  const getContainerStyle = () => {
    switch (variant) {
      case 'filled':
        return {
          backgroundColor: theme.surfaceContainerHighest,
          ...Elevation.level0,
        };
      case 'outlined':
        return {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          ...Elevation.level0,
        };
      case 'elevated':
      default:
        return {
          backgroundColor: theme.surfaceContainerLow,
          ...Elevation.level1,
        };
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        getContainerStyle(),
        {
          opacity: pressed ? 0.92 : 1,
          ...(variant === 'elevated' && pressed ? Elevation.level2 : {}),
        },
      ]}
      onPress={handleCardPress}>
      {/* Book Cover */}
      <View style={[styles.coverWrapper, { backgroundColor: theme.surfaceContainerHighest }]}>
        <Image
          source={{ uri: book.cover }}
          style={styles.cover}
          contentFit="cover"
          transition={200}
        />
      </View>

      {/* Book Information */}
      <View style={styles.info}>
        <View>
          <Text
            style={[
              Typography.titleMedium,
              styles.title,
              { color: theme.onSurface },
            ]}
            numberOfLines={2}>
            {book.title}
          </Text>

          <Text
            style={[
              Typography.bodySmall,
              styles.author,
              { color: theme.onSurfaceVariant },
            ]}
            numberOfLines={1}>
            {book.author || '未知作者'}
          </Text>
        </View>

        {/* MD3 Format & Metadata Chips */}
        <View style={styles.tagRow}>
          <Chip
            variant="badge"
            colorRole="primary"
            label={book.extension?.toUpperCase() || 'BOOK'}
          />

          {book.filesizeString ? (
            <Chip
              variant="badge"
              colorRole="surface"
              label={book.filesizeString}
            />
          ) : null}

          {book.year ? (
            <Chip
              variant="badge"
              colorRole="surface"
              label={String(book.year)}
            />
          ) : null}

          {book.language ? (
            <Chip
              variant="badge"
              colorRole="surface"
              label={book.language}
            />
          ) : null}
        </View>

        {/* MD3 Action Button */}
        <View style={styles.actionRow}>
          {isDownloading ? (
            <Button
              variant="tonal"
              size="small"
              disabled
              title={`${task?.progress || 0}%`}
              icon={<ActivityIndicator size="small" color={theme.onSecondaryContainer} />}
            />
          ) : isCompleted ? (
            <Button
              variant="tonal"
              size="small"
              onPress={handleAction}
              title="阅读"
              icon={<BookOpen size={14} color={theme.primary} />}
              textStyle={{ color: theme.primary }}
              style={{ backgroundColor: theme.primaryContainer }}
            />
          ) : (
            <Button
              variant="filled"
              size="small"
              onPress={handleAction}
              title="下载"
              icon={<Download size={14} color={theme.onPrimary} />}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Shape.medium, // MD3 12dp
    marginHorizontal: Spacing.large,
    marginVertical: Spacing.extraSmall + 2,
    padding: Spacing.medium,
    overflow: 'hidden',
  },
  coverWrapper: {
    borderRadius: Shape.small, // MD3 8dp
    overflow: 'hidden',
    width: 76,
    height: 110,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    marginLeft: Spacing.medium,
    justifyContent: 'space-between',
  },
  title: {
    fontWeight: '600',
    lineHeight: 20,
  },
  author: {
    marginTop: Spacing.extraSmall,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.extraSmall,
    marginTop: Spacing.small,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: Spacing.small,
  },
});
