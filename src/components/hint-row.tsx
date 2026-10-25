import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Shape, Spacing } from '@/constants/theme';

type HintRowProps = {
  title?: string;
  hint?: ReactNode;
};

export function HintRow({ title = 'Try editing', hint = 'app/index.tsx' }: HintRowProps) {
  return (
    <View style={styles.stepRow}>
      <ThemedText variant="bodyMedium">{title}</ThemedText>
      <ThemedView
        containerRole="surfaceContainerHigh"
        shape="extraSmall"
        style={styles.codeSnippet}>
        <ThemedText variant="labelSmall" colorRole="onSurfaceVariant">
          {hint}
        </ThemedText>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  codeSnippet: {
    paddingVertical: Spacing.extraSmall,
    paddingHorizontal: Spacing.small,
  },
});
