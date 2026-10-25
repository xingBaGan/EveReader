import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageSquare, Sparkles, X, Eye, EyeOff } from 'lucide-react-native';
import { useReaderStore } from '../../stores/useReaderStore';

interface BubbleFloatingPillProps {
  onToggle: () => void;
  onRefresh?: () => void;
}

export const BubbleFloatingPill: React.FC<BubbleFloatingPillProps> = ({
  onToggle,
  onRefresh,
}) => {
  const insets = useSafeAreaInsets();
  const isBubbleDetectActive = useReaderStore((s) => s.isBubbleDetectActive);
  const isDetectingBubbles = useReaderStore((s) => s.isDetectingBubbles);
  const detectedBubbles = useReaderStore((s) => s.detectedBubbles);
  const isBarsVisible = useReaderStore((s) => s.isBarsVisible);

  // Offset pill down if top bar is visible
  const topPos = isBarsVisible
    ? Math.max(insets.top + 52, 60)
    : Math.max(insets.top + 12, 20);

  if (!isBubbleDetectActive) {
    // When OFF: Show a subtle quick-enable pill
    return (
      <View style={[styles.container, { top: topPos }]}>
        <Pressable
          style={({ pressed }) => [
            styles.pill,
            styles.pillInactive,
            pressed && styles.pillPressed,
          ]}
          onPress={onToggle}>
          <MessageSquare size={14} color="#94a3b8" />
          <Text style={styles.textInactive}>气泡检测</Text>
        </Pressable>
      </View>
    );
  }

  // When ON: Show status with bubble count or loading spinner
  return (
    <View style={[styles.container, { top: topPos }]}>
      <View style={[styles.pill, styles.pillActive]}>
        {isDetectingBubbles ? (
          <View style={styles.contentRow}>
            <ActivityIndicator size="small" color="#38bdf8" style={styles.spinner} />
            <Text style={styles.textActive}>检测中...</Text>
          </View>
        ) : (
          <Pressable
            style={styles.contentRow}
            onPress={onRefresh}
            hitSlop={6}>
            <Sparkles size={14} color="#38bdf8" />
            <Text style={styles.textActive}>
              {detectedBubbles.length > 0
                ? `气泡: ${detectedBubbles.length}个`
                : '未发现气泡'}
            </Text>
          </Pressable>
        )}

        <View style={styles.divider} />

        <Pressable
          style={styles.closeBtn}
          onPress={onToggle}
          hitSlop={8}>
          <X size={13} color="#94a3b8" />
        </Pressable>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  pillInactive: {
    backgroundColor: 'rgba(24, 25, 26, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 6,
  },
  pillActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.65)',
  },
  pillPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spinner: {
    transform: [{ scale: 0.75 }],
  },
  textInactive: {
    fontSize: 12,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  textActive: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38bdf8',
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
    marginHorizontal: 8,
  },
  closeBtn: {
    padding: 2,
  },
});
