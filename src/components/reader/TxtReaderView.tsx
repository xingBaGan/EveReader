import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { useReaderStore } from '../../stores/useReaderStore';
import { READER_THEMES, TocItem } from '../../types/reader';
import { readBookAsText } from '../../utils/fileStorage';

interface TxtChapter {
  id: string;
  title: string;
  content: string;
  startIndex: number;
}

interface TxtReaderViewProps {
  uri: string;
  onToggleBars: () => void;
}

export function TxtReaderView({ uri, onToggleBars }: TxtReaderViewProps) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<TxtChapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const scrollViewRef = useRef<any>(null);
  const settings = useReaderStore((s) => s.settings);
  const onRelocated = useReaderStore((s) => s.onRelocated);
  const setToc = useReaderStore((s) => s.setToc);
  const currentProgress = useReaderStore((s) => s.currentProgress);

  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const text = await readBookAsText(uri);
        if (!isMounted) return;

        // Chapter splitting regex
        const chapterRegex = /(?:^|\n)\s*(第[0-9一二三四五六七八九十百千0-9]+[章回节卷集幕篇部][^\n\r]{0,30})/g;
        const matches: { title: string; index: number }[] = [];
        let match;
        while ((match = chapterRegex.exec(text)) !== null) {
          matches.push({ title: match[1].trim(), index: match.index });
        }

        const parsedChapters: TxtChapter[] = [];
        if (matches.length > 0) {
          for (let i = 0; i < matches.length; i++) {
            const start = matches[i].index;
            const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
            parsedChapters.push({
              id: `chap_${i}`,
              title: matches[i].title,
              content: text.substring(start, end).trim(),
              startIndex: start,
            });
          }
        } else {
          // If no chapters matched, chunk text by 3000 chars
          const CHUNK = 3000;
          for (let i = 0; i < text.length; i += CHUNK) {
            const partIdx = Math.floor(i / CHUNK) + 1;
            parsedChapters.push({
              id: `part_${partIdx}`,
              title: `第 ${partIdx} 部分`,
              content: text.substring(i, i + CHUNK),
              startIndex: i,
            });
          }
        }

        setChapters(parsedChapters);

        // Populate TOC
        const tocList: TocItem[] = parsedChapters.map((c) => ({
          id: c.id,
          href: c.id,
          label: c.title,
        }));
        setToc(tocList);

        // Resume progress if exists
        if (currentProgress > 0 && parsedChapters.length > 0) {
          const targetIndex = Math.min(
            parsedChapters.length - 1,
            Math.floor((currentProgress / 100) * parsedChapters.length)
          );
          setCurrentChapterIndex(targetIndex);
        }

        setLoading(false);
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || '读取 TXT 失败');
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [uri]);

  const activeChapter = chapters[currentChapterIndex];

  useEffect(() => {
    if (chapters.length > 0 && activeChapter) {
      const progress = ((currentChapterIndex + 1) / chapters.length) * 100;
      onRelocated(activeChapter.id, progress, activeChapter.title);
    }
  }, [currentChapterIndex, chapters.length]);

  const goToPrevChapter = () => {
    if (currentChapterIndex > 0) {
      setCurrentChapterIndex((prev) => prev - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const goToNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      setCurrentChapterIndex((prev) => prev + 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerBox, { backgroundColor: themeConfig.bg }]}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={[styles.loadingText, { color: themeConfig.text }]}>
          正在解析文本内容...
        </Text>
      </View>
    );
  }

  if (error || !activeChapter) {
    return (
      <View style={[styles.centerBox, { backgroundColor: themeConfig.bg }]}>
        <Text style={[styles.errorText, { color: themeConfig.text }]}>
          {error || '无法展示文本内容'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeConfig.bg }]}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Click zones */}
        <Pressable
          style={styles.contentPressable}
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            if (x < width * 0.25) {
              goToPrevChapter();
            } else if (x > width * 0.75) {
              goToNextChapter();
            } else {
              onToggleBars();
            }
          }}>
          <Text
            style={[
              styles.chapterHeader,
              {
                color: themeConfig.text,
                fontSize: settings.fontSize + 4,
              },
            ]}>
            {activeChapter.title}
          </Text>

          <Text
            style={[
              styles.bodyText,
              {
                color: themeConfig.text,
                fontSize: settings.fontSize,
                lineHeight: settings.fontSize * settings.lineHeight,
              },
            ]}>
            {activeChapter.content}
          </Text>

          <View style={styles.footerNav}>
            <Pressable
              style={[styles.footerBtn, currentChapterIndex === 0 && styles.footerBtnDisabled]}
              onPress={goToPrevChapter}
              disabled={currentChapterIndex === 0}>
              <Text style={[styles.footerBtnText, { color: themeConfig.barText }]}>上一章</Text>
            </Pressable>

            <Text style={[styles.footerPageInfo, { color: themeConfig.barText }]}>
              {currentChapterIndex + 1} / {chapters.length}
            </Text>

            <Pressable
              style={[
                styles.footerBtn,
                currentChapterIndex === chapters.length - 1 && styles.footerBtnDisabled,
              ]}
              onPress={goToNextChapter}
              disabled={currentChapterIndex === chapters.length - 1}>
              <Text style={[styles.footerBtnText, { color: themeConfig.barText }]}>下一章</Text>
            </Pressable>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 60,
  },
  contentPressable: {
    minHeight: '100%',
  },
  chapterHeader: {
    fontWeight: '800',
    marginBottom: 20,
    marginTop: 10,
  },
  bodyText: {
    letterSpacing: 0.5,
  },
  footerNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 36,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(100, 116, 139, 0.2)',
  },
  footerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
  },
  footerBtnDisabled: {
    opacity: 0.4,
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  footerPageInfo: {
    fontSize: 12,
    opacity: 0.7,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
  },
});
