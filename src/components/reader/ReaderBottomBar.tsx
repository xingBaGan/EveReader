import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES } from '../../types/reader';

interface ReaderBottomBarProps {
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  onSeekProgress?: (progress: number) => void;
}

export function ReaderBottomBar({
  onPrevChapter,
  onNextChapter,
  onSeekProgress,
}: ReaderBottomBarProps) {
  const settings = useReaderStore((s) => s.settings);
  const updateSettings = useReaderStore((s) => s.updateSettings);
  const currentProgress = useReaderStore((s) => s.currentProgress);
  const currentChapterTitle = useReaderStore((s) => s.currentChapterTitle);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isDark = settings.theme === 'dark' || settings.theme === 'black';

  const toggleDayNight = () => {
    updateSettings({
      theme: isDark ? 'sepia' : 'dark',
    });
  };

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[
        styles.container,
        {
          backgroundColor: themeConfig.barBg,
          borderTopColor: themeConfig.barBorder,
        },
      ]}>
      {/* Chapter & Progress Info */}
      <View style={styles.infoRow}>
        <Text style={[styles.chapterText, { color: themeConfig.barText }]} numberOfLines={1}>
          {currentChapterTitle || '阅读中'}
        </Text>
        <Text style={[styles.percentText, { color: themeConfig.barText }]}>
          {currentProgress.toFixed(1)}%
        </Text>
      </View>

      {/* Slider / Scrubbing Track */}
      <View style={styles.scrubberRow}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => {
            const next = Math.max(0, currentProgress - 5);
            onSeekProgress?.(next);
          }}>
          <Text style={[styles.stepBtnText, { color: themeConfig.barText }]}>-5%</Text>
        </Pressable>

        <View style={styles.trackContainer}>
          <Pressable
            style={styles.trackBg}
            onPress={(e) => {
              const { locationX } = e.nativeEvent;
              // Simple approximate seek: 220px track width
              const ratio = Math.max(0, Math.min(1, locationX / 200));
              onSeekProgress?.(ratio * 100);
            }}>
            <View
              style={[
                styles.trackFill,
                { width: `${Math.min(100, Math.max(0, currentProgress))}%` },
              ]}
            />
          </Pressable>
        </View>

        <Pressable
          style={styles.stepBtn}
          onPress={() => {
            const next = Math.min(100, currentProgress + 5);
            onSeekProgress?.(next);
          }}>
          <Text style={[styles.stepBtnText, { color: themeConfig.barText }]}>+5%</Text>
        </Pressable>
      </View>

      {/* Navigation Controls */}
      <View style={styles.controlsRow}>
        <Pressable
          style={styles.navBtn}
          onPress={onPrevChapter}>
          <ChevronLeft size={18} color={themeConfig.barText} />
          <Text style={[styles.navBtnText, { color: themeConfig.barText }]}>上一章</Text>
        </Pressable>

        <Pressable style={styles.themeToggleBtn} onPress={toggleDayNight}>
          {isDark ? (
            <Sun size={18} color="#eab308" />
          ) : (
            <Moon size={18} color={themeConfig.barText} />
          )}
          <Text style={[styles.navBtnText, { color: themeConfig.barText }]}>
            {isDark ? '日间' : '夜间'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.navBtn}
          onPress={onNextChapter}>
          <Text style={[styles.navBtnText, { color: themeConfig.barText }]}>下一章</Text>
          <ChevronRight size={18} color={themeConfig.barText} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chapterText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
  },
  percentText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  stepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
  },
  stepBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  trackContainer: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  trackBg: {
    height: 6,
    backgroundColor: 'rgba(100, 116, 139, 0.25)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#0284c7',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  themeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
  },
  navBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
