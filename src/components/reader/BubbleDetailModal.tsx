import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, RefreshCw } from 'lucide-react-native';
import { TextBubble } from '../../types/manga';
import { useReaderStore } from '../../stores/useReaderStore';

interface Props {
  bubble: TextBubble | null;
  visible: boolean;
  onClose: () => void;
  onRetryTranslate?: (bubble: TextBubble) => void;
}

export const BubbleDetailModal: React.FC<Props> = ({
  bubble,
  visible,
  onClose,
  onRetryTranslate,
}) => {
  const insets = useSafeAreaInsets();
  const settings = useReaderStore((s) => s.settings);
  const isDark = settings.theme === 'dark' || settings.theme === 'black';

  if (!bubble) return null;

  const isTranslating = bubble.translationStatus === 'translating';
  const isError = bubble.translationStatus === 'error';
  const hasTarget = Boolean(bubble.targetText && bubble.targetText.trim().length > 0);

  return (
    <Modal
      transparent
      animationType="slide"
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
          {/* Top Drag Indicator & Header */}
          <View style={styles.dragHandleContainer}>
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: isDark ? '#475569' : '#cbd5e1' },
              ]}
            />
          </View>

          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>
              翻译详情
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="关闭详情面板">
              <X size={20} color={isDark ? '#94a3b8' : '#64748b'} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Primary Section: 译文优先 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: isDark ? '#38bdf8' : '#0284c7' },
                  ]}>
                  中文译文
                </Text>

                {isTranslating ? (
                  <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color="#0284c7" />
                    <Text style={[styles.statusText, { color: '#0284c7' }]}>
                      正在离线翻译…
                    </Text>
                  </View>
                ) : isError ? (
                  <Pressable
                    style={styles.retryBtn}
                    onPress={() => onRetryTranslate?.(bubble)}
                    accessibilityRole="button"
                    accessibilityLabel="重试翻译">
                    <RefreshCw size={12} color="#ef4444" style={styles.retryIcon} />
                    <Text style={[styles.retryBtnText, { color: '#ef4444' }]}>重试</Text>
                  </Pressable>
                ) : !hasTarget ? (
                  <Pressable
                    style={styles.retryBtn}
                    onPress={() => onRetryTranslate?.(bubble)}
                    accessibilityRole="button"
                    accessibilityLabel="开始翻译">
                    <RefreshCw size={12} color="#0284c7" style={styles.retryIcon} />
                    <Text style={[styles.retryBtnText, { color: '#0284c7' }]}>翻译</Text>
                  </Pressable>
                ) : null}
              </View>

              {hasTarget ? (
                <View
                  style={[
                    styles.cardBox,
                    styles.targetBox,
                    {
                      backgroundColor: isDark
                        ? 'rgba(56, 189, 248, 0.12)'
                        : 'rgba(2, 132, 199, 0.08)',
                      borderColor: isDark ? '#0284c7' : '#38bdf8',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.targetText,
                      { color: isDark ? '#f0f9ff' : '#0c4a6e' },
                    ]}>
                    {bubble.targetText}
                  </Text>
                </View>
              ) : isTranslating ? (
                <View
                  style={[
                    styles.cardBox,
                    {
                      backgroundColor: isDark ? '#27292d' : '#f8fafc',
                      borderColor: isDark ? '#374151' : '#e2e8f0',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 18,
                    },
                  ]}>
                  <ActivityIndicator size="small" color="#0284c7" />
                  <Text
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      color: isDark ? '#94a3b8' : '#64748b',
                    }}>
                    正在离线翻译…
                  </Text>
                </View>
              ) : isError ? (
                <View
                  style={[
                    styles.cardBox,
                    {
                      backgroundColor: isDark
                        ? 'rgba(239, 68, 68, 0.12)'
                        : 'rgba(239, 68, 68, 0.06)',
                      borderColor: '#ef4444',
                    },
                  ]}>
                  <Text style={{ fontSize: 13, color: '#ef4444' }}>
                    暂时无法完成翻译，请重试。若问题持续，请检查离线模型是否可用。
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.cardBox,
                    {
                      backgroundColor: isDark ? '#27292d' : '#f8fafc',
                      borderColor: isDark ? '#374151' : '#e2e8f0',
                    },
                  ]}>
                  <Text style={{ fontSize: 13, color: isDark ? '#64748b' : '#94a3b8' }}>
                    暂无中文译文，可点击右上角发起翻译
                  </Text>
                </View>
              )}
            </View>

            {/* Secondary Section: 原文次级 */}
            <View style={[styles.section, { marginTop: 14 }]}>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: isDark ? '#94a3b8' : '#64748b' },
                  ]}>
                  日文原文
                </Text>
              </View>

              <View
                style={[
                  styles.cardBox,
                  {
                    backgroundColor: isDark ? '#27292d' : '#f8fafc',
                    borderColor: isDark ? '#374151' : '#e2e8f0',
                  },
                ]}>
                <Text
                  style={[
                    styles.sourceText,
                    { color: isDark ? '#cbd5e1' : '#334155' },
                  ]}>
                  {bubble.sourceText || '未获取到文字内容'}
                </Text>
              </View>
            </View>

            {/* Optional Notes */}
            {bubble.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesText}>{bubble.notes}</Text>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
    paddingHorizontal: 18,
    maxHeight: '65%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 12,
  },
  dragHandleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingVertical: 6,
  },
  section: {
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
  },
  retryIcon: {
    marginRight: 4,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  targetBox: {
    borderWidth: 1.5,
  },
  targetText: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
  },
  sourceText: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '400',
  },
  notesBox: {
    marginTop: 12,
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
