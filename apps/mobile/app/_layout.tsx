// Must be the first import in the app (react-native-gesture-handler requirement),
// so the drawer's swipe gesture and the timetable's per-screen opt-out both work.
import 'react-native-gesture-handler';
import '@/i18n';

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />;
}

/**
 * App-wide providers only. The drawer itself lives in app/(drawer)/_layout.tsx —
 * per docs/03-navigation.md, auth/onboarding would render outside the drawer
 * entirely, so this root stays a thin `<Slot />` rather than a Stack that
 * assumes every route is inside the drawer. There's no auth group in this
 * scaffold (out of scope); see README "Open questions".
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <Slot />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
