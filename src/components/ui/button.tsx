import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  type PressableProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Elevation, Shape, Spacing, Typography } from '@/constants/theme';

export type ButtonVariant = 'filled' | 'tonal' | 'elevated' | 'outlined' | 'text';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  style?: ViewStyle | ((state: { pressed: boolean }) => ViewStyle);
  textStyle?: TextStyle;
  children?: React.ReactNode;
}

export function Button({
  variant = 'filled',
  size = 'medium',
  title,
  icon,
  iconPosition = 'left',
  loading = false,
  disabled,
  style,
  textStyle,
  children,
  ...rest
}: ButtonProps) {
  const theme = useTheme();

  // MD3 Button Colors
  const getColors = () => {
    if (disabled) {
      return {
        bg: variant === 'outlined' || variant === 'text' ? 'transparent' : 'rgba(29, 27, 32, 0.12)',
        text: 'rgba(29, 27, 32, 0.38)',
        border: variant === 'outlined' ? 'rgba(29, 27, 32, 0.12)' : 'transparent',
      };
    }

    switch (variant) {
      case 'filled':
        return {
          bg: theme.primary,
          text: theme.onPrimary,
          border: 'transparent',
        };
      case 'tonal':
        return {
          bg: theme.secondaryContainer,
          text: theme.onSecondaryContainer,
          border: 'transparent',
        };
      case 'elevated':
        return {
          bg: theme.surfaceContainerLow,
          text: theme.primary,
          border: 'transparent',
        };
      case 'outlined':
        return {
          bg: 'transparent',
          text: theme.primary,
          border: theme.outline,
        };
      case 'text':
      default:
        return {
          bg: 'transparent',
          text: theme.primary,
          border: 'transparent',
        };
    }
  };

  const colors = getColors();

  // MD3 Sizing
  const sizeStyles: Record<ButtonSize, { height: number; paddingHorizontal: number; gap: number }> = {
    small: { height: 32, paddingHorizontal: 12, gap: 6 },
    medium: { height: 40, paddingHorizontal: 16, gap: 8 },
    large: { height: 48, paddingHorizontal: 24, gap: 10 },
  };

  const currentSize = sizeStyles[size];

  const elevationStyle: ViewStyle =
    variant === 'elevated' && !disabled ? Elevation.level1 : Elevation.level0;

  return (
    <Pressable
      disabled={disabled || loading}
      style={(state) => [
        styles.base,
        {
          height: currentSize.height,
          paddingHorizontal: currentSize.paddingHorizontal,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderWidth: variant === 'outlined' ? 1 : 0,
          borderRadius: Shape.full,
          opacity: state.pressed && !disabled ? 0.85 : 1,
        },
        elevationStyle,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <View style={[styles.contentRow, { gap: currentSize.gap }]}>
          {icon && iconPosition === 'left' ? icon : null}
          {title ? (
            <Text
              style={[
                styles.label,
                size === 'small' ? Typography.labelMedium : Typography.labelLarge,
                { color: colors.text },
                textStyle,
              ]}>
              {title}
            </Text>
          ) : (
            children
          )}
          {icon && iconPosition === 'right' ? icon : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
