import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, X, AlertCircle } from 'lucide-react-native';
import { useReaderStore, TranslationPageStatus } from '../../stores/useReaderStore';

interface BubbleFloatingPillProps {
  onToggle: () => void;
  onRefresh?: () => void;
  pageStatus?: TranslationPageStatus;
  errorMessage?: string;
  onDismiss?: () => void;
}

export const BubbleFloatingPill: React.FC<BubbleFloatingPillProps> = ({
  onToggle,
  onRefresh,
  pageStatus = 'idle',
  errorMessage,
  onDismiss,
}) => {
  const insets = useSafeAreaInsets();
  const isBubbleDetectActive = useReaderStore((s) => s.isBubbleDetectActive);
  const isBarsVisible = useReaderStore((s) => s.isBarsVisible);

  // 仅在翻译开启期间显示状态
  if (!isBubbleDetectActive) {
    return null;
  }

  // 正常完成时静默隐藏，不常驻遮挡读者画面，不显示冗余气泡计数
  if (pageStatus === 'completed' || pageStatus === 'idle') {
    return null;
  }

  const topPos = isBarsVisible
    ? Math.max(insets.top + 52, 60)
    : Math.max(insets.top + 12, 20);

  const handleClose = () => {
    if (onDismiss) {
      onDismiss();
    } else {
      onToggle();
    }
  };

  return (
    <View style={[styles.container, { top: topPos }]}>
      <View style={styles.pill}>
        {pageStatus === 'loading' ? (
          <View style={styles.contentRow}>
            <ActivityIndicator size="small" color="#38bdf8" style={styles.spinner} />
            <Text style={styles.loadingText}>正在识别与翻译…</Text>
          </View>
        ) : pageStatus === 'error' ? (
          <View style={styles.contentRow}>
            <AlertCircle size={14} color="#f87171" />
            <Text style={styles.errorText} numberOfLines={1}>
              {errorMessage || '翻译遇到问题'}
            </Text>
            {onRefresh ? (
              <Pressable
                style={styles.actionBtn}
                onPress={onRefresh}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="重试翻译">
                <RefreshCw size={12} color="#38bdf8" />
                <Text style={styles.actionBtnText}>重试</Text>
              </Pressable>
            ) : null}
            <View style={styles.divider} />
            <Pressable
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="关闭提示">
              <X size={13} color="#94a3b8" />
            </Pressable>
          </View>
        ) : pageStatus === 'zero_text' ? (
          <View style={styles.contentRow}>
            <Text style={styles.infoText}>本页未检测到文字</Text>
            {onRefresh ? (
              <Pressable
                style={styles.actionBtn}
                onPress={onRefresh}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="重新检测">
                <RefreshCw size={12} color="#38bdf8" />
                <Text style={styles.actionBtnText}>重试</Text>
              </Pressable>
            ) : null}
            <View style={styles.divider} />
            <Pressable
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="关闭提示">
              <X size={13} color="#94a3b8" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 14,
    zIndex: 45,
    elevation: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spinner: {
    transform: [{ scale: 0.75 }],
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38bdf8',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#f87171',
    maxWidth: 160,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#38bdf8',
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
    marginHorizontal: 4,
  },
  closeBtn: {
    padding: 2,
  },
});
