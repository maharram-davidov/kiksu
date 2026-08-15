import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { typography } from '@kiksu/tokens';
import { darkColors, lightColors, type ThemeColors } from './colors';
import { fontFamilies, radiiPx, spacingPx, textStyle } from './rnTokens';

export interface Theme {
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacingPx;
  radii: typeof radiiPx;
  fontFamilies: typeof fontFamilies;
  /** Resolves a `typography.<group>.<size>` entry into an RN text style. */
  text: typeof textStyle;
}

const ThemeContext = createContext<Theme | null>(null);

function buildTheme(mode: 'light' | 'dark'): Theme {
  return {
    mode,
    colors: mode === 'dark' ? darkColors : lightColors,
    spacing: spacingPx,
    radii: radiiPx,
    fontFamilies,
    text: textStyle,
  };
}

/**
 * Provides the theme, chosen from the device's light/dark setting
 * (`Appearance` via `useColorScheme`). There is no in-app override yet —
 * Kiksu follows the OS, per the navigation spec's "light and dark, following
 * the device setting" requirement. A manual override toggle would live in
 * `/profile` and is out of scope for this scaffold.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => buildTheme(scheme === 'dark' ? 'dark' : 'light'), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme() must be used within a <ThemeProvider>');
  }
  return theme;
}

// Re-exported so screens can build typed text styles without reaching into tokens directly.
export { typography };
