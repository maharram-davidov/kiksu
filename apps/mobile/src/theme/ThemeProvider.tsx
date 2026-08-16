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
 * DARK MODE IS DEFERRED TO THE END OF THE PROJECT (product decision).
 *
 * The plumbing below is complete and every screen already reads its colours
 * through the theme, so switching dark mode on later is a one-line change
 * here. What is NOT done is the dark palette itself: `darkColors` is derived
 * arithmetically from the light tokens and has no design source of truth, so
 * shipping it now would put an undesigned theme in front of testers and
 * invite feedback on something nobody has designed yet.
 *
 * `useColorScheme` stays wired up deliberately — it keeps the dependency
 * honest and means the eventual switch is exercised, not resurrected.
 *
 * TO ENABLE, once the dark palette has been designed:
 *   1. replace the derived values in `./colors.ts` with the real palette
 *   2. set FOLLOW_DEVICE_APPEARANCE to true
 *   3. add the manual override toggle on /profile (PF-10 Appearance)
 */
const FOLLOW_DEVICE_APPEARANCE = false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const mode = FOLLOW_DEVICE_APPEARANCE && scheme === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => buildTheme(mode), [mode]);
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
