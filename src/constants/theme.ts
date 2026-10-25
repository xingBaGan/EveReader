/**
 * Material Design 3 Design Tokens and Theme Configuration
 * Based on Google's Material Design 3 specification:
 * - Color Roles (Primary, Secondary, Tertiary, Surface containers, Outline, Error)
 * - Shape scale (none, extraSmall, small, medium, large, extraLarge, full)
 * - 8dp Spacing System
 * - Baseline Typography Scale (Display, Headline, Title, Body, Label)
 * - Elevation levels & State layers
 */

import '@/global.css';
import { Platform } from 'react-native';

export const MD3Colors = {
  light: {
    // Primary
    primary: '#0061A4',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D1E4FF',
    onPrimaryContainer: '#001D36',

    // Secondary
    secondary: '#535F70',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#D7E3F7',
    onSecondaryContainer: '#101C2B',

    // Tertiary
    tertiary: '#6B5778',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#F2DAFF',
    onTertiaryContainer: '#251431',

    // Error
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',

    // Surface & Background
    surface: '#FEF7FF',
    onSurface: '#1D1B20',
    onSurfaceVariant: '#49454F',
    surfaceDim: '#DED8E1',
    surfaceBright: '#FEF7FF',

    // Surface Container Hierarchy (Tonal surfaces)
    surfaceContainerLowest: '#FFFFFF',
    surfaceContainerLow: '#F7F2FA',
    surfaceContainer: '#F3EDF7',
    surfaceContainerHigh: '#ECE6F0',
    surfaceContainerHighest: '#E6E0E9',

    // Outlines
    outline: '#79747E',
    outlineVariant: '#CAC4D0',

    // Inverse
    inverseSurface: '#322F35',
    inverseOnSurface: '#F5EFF7',
    inversePrimary: '#9ECAFF',

    // Legacy Aliases for backward compatibility
    text: '#1D1B20',
    background: '#FEF7FF',
    backgroundElement: '#F3EDF7',
    backgroundSelected: '#D7E3F7',
    textSecondary: '#49454F',
  },
  dark: {
    // Primary
    primary: '#9ECAFF',
    onPrimary: '#003258',
    primaryContainer: '#00497D',
    onPrimaryContainer: '#D1E4FF',

    // Secondary
    secondary: '#BBC7DB',
    onSecondary: '#253140',
    secondaryContainer: '#3B4858',
    onSecondaryContainer: '#D7E3F7',

    // Tertiary
    tertiary: '#D6BEE4',
    onTertiary: '#3B2948',
    tertiaryContainer: '#523F5F',
    onTertiaryContainer: '#F2DAFF',

    // Error
    error: '#FFB4AB',
    onError: '#690005',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',

    // Surface & Background
    surface: '#141218',
    onSurface: '#E6E0E9',
    onSurfaceVariant: '#CAC4D0',
    surfaceDim: '#141218',
    surfaceBright: '#3B383E',

    // Surface Container Hierarchy (Tonal surfaces)
    surfaceContainerLowest: '#0F0D13',
    surfaceContainerLow: '#1D1B20',
    surfaceContainer: '#211F26',
    surfaceContainerHigh: '#2B2930',
    surfaceContainerHighest: '#36343B',

    // Outlines
    outline: '#938F99',
    outlineVariant: '#49454F',

    // Inverse
    inverseSurface: '#E6E0E9',
    inverseOnSurface: '#322F35',
    inversePrimary: '#0061A4',

    // Legacy Aliases for backward compatibility
    text: '#E6E0E9',
    background: '#141218',
    backgroundElement: '#211F26',
    backgroundSelected: '#3B4858',
    textSecondary: '#CAC4D0',
  },
} as const;

export const Colors = MD3Colors;

export type MD3ColorScheme = typeof MD3Colors.light;
export type ThemeColor = keyof typeof MD3Colors.light & keyof typeof MD3Colors.dark;

/**
 * MD3 Shape Tokens
 * Defined in Material 3 Shape scale
 */
export const Shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999,
} as const;

export type ShapeKey = keyof typeof Shape;

/**
 * MD3 Elevation Levels
 */
export const Elevation = {
  level0: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  level1: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 3,
    elevation: 1,
  },
  level2: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  level3: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 4,
  },
  level4: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.26,
    shadowRadius: 8,
    elevation: 6,
  },
  level5: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
} as const;

export type ElevationLevel = keyof typeof Elevation;

/**
 * MD3 Typography Baseline Scale
 */
export const Typography = {
  displayLarge: {
    fontSize: 57,
    lineHeight: 64,
    fontWeight: '400' as const,
    letterSpacing: -0.25,
  },
  displayMedium: {
    fontSize: 45,
    lineHeight: 52,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  displaySmall: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  headlineLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  headlineMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  headlineSmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  titleLarge: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  titleMedium: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500' as const,
    letterSpacing: 0.15,
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.4,
  },
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
} as const;

export type TypographyStyleKey = keyof typeof Typography;

/**
 * MD3 State Layer Opacities
 */
export const StateLayer = {
  hover: 0.08,
  focus: 0.12,
  pressed: 0.12,
  dragged: 0.16,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * MD3 8dp Spacing System
 */
export const Spacing = {
  none: 0,
  extraSmall: 4,       // 0.5x
  small: 8,            // 1x
  medium: 12,          // 1.5x
  large: 16,           // 2x
  extraLarge: 24,      // 3x
  twoExtraLarge: 32,   // 4x
  threeExtraLarge: 48, // 6x
  fourExtraLarge: 64,  // 8x

  // Legacy mappings
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
