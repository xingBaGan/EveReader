import React from 'react';
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor, Typography, TypographyStyleKey, MD3ColorScheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type LegacyTextType =
  | 'default'
  | 'title'
  | 'small'
  | 'smallBold'
  | 'subtitle'
  | 'link'
  | 'linkPrimary'
  | 'code';

export type ThemedTextProps = TextProps & {
  /**
   * MD3 Typography scale or legacy text type
   */
  variant?: TypographyStyleKey | LegacyTextType;
  /**
   * Kept for backwards compatibility
   */
  type?: LegacyTextType | TypographyStyleKey;
  /**
   * Color role in the MD3 Color Scheme (e.g. 'onSurface', 'primary', 'onSurfaceVariant')
   */
  colorRole?: keyof MD3ColorScheme;
  /**
   * Kept for backwards compatibility
   */
  themeColor?: ThemeColor;
  /**
   * MD3 Expressive: emphasized typography weight
   */
  emphasized?: boolean;
};

export function ThemedText({
  style,
  type,
  variant = 'bodyMedium',
  colorRole,
  themeColor,
  emphasized,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  // Resolve style key: type takes precedence if passed for backward compat, else variant
  const activeKey = type ?? variant;

  let resolvedStyle: TextStyle = {};
  if (activeKey in Typography) {
    resolvedStyle = { ...Typography[activeKey as TypographyStyleKey] };
  } else if (activeKey in legacyStyles) {
    resolvedStyle = { ...legacyStyles[activeKey as LegacyTextType] };
  } else {
    resolvedStyle = { ...Typography.bodyMedium };
  }

  // Emphasized style (higher font weight per MD3 Expressive)
  if (emphasized) {
    resolvedStyle = { ...resolvedStyle, fontWeight: '700' };
  }

  // Color resolution: colorRole -> themeColor -> default based on style
  const textColor =
    (colorRole && theme[colorRole]) ??
    (themeColor && theme[themeColor]) ??
    theme.onSurface;

  return (
    <Text
      style={[
        { color: textColor },
        resolvedStyle,
        style,
      ]}
      {...rest}
    />
  );
}

const legacyStyles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  title: {
    fontSize: 48,
    fontWeight: '600',
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: '600',
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#0061A4',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: '700' }) ?? '500',
    fontSize: 12,
  },
});
