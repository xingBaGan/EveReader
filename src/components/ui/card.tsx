import React from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Elevation, Shape, ShapeKey } from '@/constants/theme';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

export interface CardProps extends Omit<PressableProps, 'style'> {
  variant?: CardVariant;
  shape?: ShapeKey;
  children: React.ReactNode;
  style?: ViewStyle | ((state: { pressed: boolean }) => ViewStyle);
  onPress?: () => void;
}

export function Card({
  variant = 'elevated',
  shape = 'medium',
  children,
  style,
  onPress,
  disabled,
  ...rest
}: CardProps) {
  const theme = useTheme();

  const getCardStyle = (): ViewStyle => {
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

  const baseStyle: ViewStyle = {
    borderRadius: Shape[shape],
    ...getCardStyle(),
  };

  if (!onPress) {
    return (
      <View style={[styles.card, baseStyle, style as ViewStyle]} {...(rest as ViewProps)}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={(state) => [
        styles.card,
        baseStyle,
        {
          opacity: state.pressed && !disabled ? 0.92 : 1,
          ...(variant === 'elevated' && state.pressed ? Elevation.level2 : {}),
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    overflow: 'hidden',
  },
});
