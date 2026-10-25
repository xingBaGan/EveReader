import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

import {
  Elevation,
  ElevationLevel,
  MD3ColorScheme,
  Shape,
  ShapeKey,
  ThemeColor,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  /**
   * Kept for backwards compatibility
   */
  type?: ThemeColor;
  /**
   * MD3 Surface container role (e.g. 'surfaceContainerLow', 'surfaceContainer', etc.)
   */
  containerRole?: keyof MD3ColorScheme;
  /**
   * MD3 Elevation level (0-5)
   */
  elevation?: 0 | 1 | 2 | 3 | 4 | 5 | ElevationLevel;
  /**
   * MD3 Shape token
   */
  shape?: ShapeKey;
  /**
   * Outlined surface border with outlineVariant
   */
  bordered?: boolean;
};

export function ThemedView({
  style,
  lightColor,
  darkColor,
  type,
  containerRole,
  elevation,
  shape,
  bordered,
  ...otherProps
}: ThemedViewProps) {
  const theme = useTheme();

  const backgroundColor =
    (containerRole && theme[containerRole]) ??
    (type && theme[type]) ??
    theme.surface;

  const elevationStyle: ViewStyle =
    elevation !== undefined
      ? typeof elevation === 'number'
        ? Elevation[`level${elevation}` as ElevationLevel]
        : Elevation[elevation]
      : {};

  const shapeStyle: ViewStyle =
    shape !== undefined ? { borderRadius: Shape[shape] } : {};

  const borderStyle: ViewStyle = bordered
    ? {
        borderWidth: 1,
        borderColor: theme.outlineVariant,
      }
    : {};

  return (
    <View
      style={[
        { backgroundColor },
        shapeStyle,
        elevationStyle,
        borderStyle,
        style,
      ]}
      {...otherProps}
    />
  );
}
