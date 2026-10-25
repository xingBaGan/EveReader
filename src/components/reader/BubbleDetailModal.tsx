import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Copy, Check, MessageSquare, Sparkles, Volume2, Bookmark } from 'lucide-react-native';
import { TextBubble } from '../../types/manga';
import { READER_THEMES } from '../../types/reader';
import { useReaderStore } from '../../stores/useReaderStore';

interface Props {
  bubble: TextBubble | null;
  visible: boolean;
  onClose: () => void;
}

export const BubbleDetailModal: React.FC<Props> = ({
  bubble,
  visible,
  onClose,
}) => {
  const [copied, setCopied] = React.useState(false);
  const insets = useSafeAreaInsets();
  const settings = useReaderStore((s) => s.settings);
  const themeConfig = READER_THEMES[settings.theme] || READER_THEMES.light;
  const isDark = settings.theme === 'dark' || settings.theme === 'black';

  if (!bubble) return null;

  const handleCopy = () => {
    // In React Native web / native
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(bubble.sourceText);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const getCategoryMeta = (type?: string) => {
    switch (type) {
      case 'title':
        return { label: '画面大标题', color: '#ea580c', icon: Sparkles };
      case 'sfx':
        return { label: '拟声动效词', color: '#dc2626', icon: Volume2 };
      case 'free_text':
        return { label: '旁白/嵌字', color: '#8b5cf6', icon: Bookmark };
      default:
        return { label: '对话气泡', color: '#0284c7', icon: MessageSquare };
    }
  };

  const meta = getCategoryMeta(bubble.textType);
  const IconComponent = meta.icon;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#1e2022' : '#ffffff',
              paddingBottom: Math.max(insets.bottom + 16, 24),
            },
          ]}
          onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.badgeRow}>
              <View style={[styles.orderBadge, { backgroundColor: meta.color }]}>
                <Text style={styles.orderBadgeText}>#{bubble.readingOrderIndex}</Text>
              </View>

              <View style={[styles.typeBadge, { borderColor: meta.color }]}>
                <IconComponent size={13} color={meta.color} style={{ marginRight: 4 }} />
                <Text style={[styles.typeBadgeText, { color: meta.color }]}>
                  {meta.label}
                </Text>
              </View>

              <View style={styles.dirBadge}>
                <Text style={styles.dirBadgeText}>
                  {bubble.direction === 'vertical' ? '竖排' : '横排'}
                </Text>
              </View>

              {bubble.confidence ? (
                <Text style={styles.confidenceText}>
                  {(bubble.confidence * 100).toFixed(0)}% 置信度
                </Text>
              ) : null}
            </View>

            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
              <X size={20} color={isDark ? '#94a3b8' : '#64748b'} />
            </Pressable>
          </View>

          {/* OCR Source Text (日文/外语原文) */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}>
                OCR 识别原文
              </Text>
              <Pressable style={styles.copyBtn} onPress={handleCopy}>
                {copied ? (
                  <>
                    <Check size={14} color="#10b981" />
                    <Text style={[styles.copyBtnText, { color: '#10b981' }]}>已复制</Text>
                  </>
                ) : (
                  <>
                    <Copy size={14} color="#0284c7" />
                    <Text style={[styles.copyBtnText, { color: '#0284c7' }]}>复制</Text>
                  </>
                )}
              </Pressable>
            </View>
            <View
              style={[
                styles.textBox,
                {
                  backgroundColor: isDark ? '#27292d' : '#f8fafc',
                  borderColor: isDark ? '#374151' : '#e2e8f0',
                },
              ]}>
              <Text style={[styles.sourceText, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>
                {bubble.sourceText || '(未检测到文字内容)'}
              </Text>
            </View>
          </View>

          {/* Target Translation (中文译文预览) */}
          {bubble.targetText ? (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}>
                中文翻译参考
              </Text>
              <View
                style={[
                  styles.textBox,
                  styles.targetBox,
                  {
                    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 132, 199, 0.08)',
                    borderColor: '#38bdf8',
                  },
                ]}>
                <Text style={[styles.targetText, { color: isDark ? '#38bdf8' : '#0369a1' }]}>
                  {bubble.targetText}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Notes / Tips */}
          {bubble.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>💡 {bubble.notes}</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  orderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  orderBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dirBadge: {
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dirBadgeText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
  confidenceText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  closeBtn: {
    padding: 4,
  },
  section: {
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  textBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sourceText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  targetBox: {
    borderWidth: 1.5,
  },
  targetText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  notesBox: {
    marginTop: 14,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
  },
  notesText: {
    fontSize: 12,
    color: '#b45309',
    lineHeight: 18,
  },
});
