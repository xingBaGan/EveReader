import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Shape, Typography } from '@/constants/theme';

export type ChipVariant = 'assist' | 'filter' | 'suggestion' | 'badge';

export interface ChipProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ChipVariant;
  selected?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  style?: ViewStyle | ((state: { pressed: boolean }) => ViewStyle);
  textStyle?: TextStyle;
  colorRole?: 'primary' | 'secondary' | 'tertiary' | 'surface';
}

export function Chip({
  label,
  variant = 'assist',
  selected = false,
  leadingIcon,
  trailingIcon,
  style,
  textStyle,
  colorRole = 'secondary',
  disabled,
  ...rest
}: ChipProps) {
  const theme = useTheme();

  const getColors = () => {
    if (variant === 'badge') {
      if (colorRole === 'primary') {
        return {
          bg: theme.primaryContainer,
          text: theme.onPrimaryContainer,
          border: 'transparent',
        };
      }
      if (colorRole === 'tertiary') {
        return {
          bg: theme.tertiaryContainer,
          text: theme.onTertiaryContainer,
          border: 'transparent',
        };
      }
      return {
        bg: theme.surfaceContainerHighest,
        text: theme.onSurfaceVariant,
        border: 'transparent',
      };
    }

    if (selected) {
      return {
        bg: theme.secondaryContainer,
        text: theme.onSecondaryContainer,
        border: 'transparent',
      };
    }

    return {
      bg: 'transparent',
      text: theme.onSurfaceVariant,
      border: theme.outlineVariant,
    };
  };

  const colors = getColors();
  const isBadge = variant === 'badge';

  return (
    <Pressable
      disabled={disabled || !rest.onPress}
      style={(state) => [
        isBadge ? styles.badge : styles.chip,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderWidth: colors.border !== 'transparent' ? 1 : 0,
          opacity: state.pressed && rest.onPress ? 0.75 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      <View style={styles.content}>
        {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
        <Text
          style={[
            isBadge ? Typography.labelSmall : Typography.labelMedium,
            { color: colors.text },
            textStyle,
          ]}>
          {label}
        </Text>
        {trailingIcon ? <View style={styles.icon}>{trailingIcon}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 32,
    borderRadius: Shape.small,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Shape.extraSmall,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
