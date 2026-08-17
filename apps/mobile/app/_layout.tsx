// Must be the first import in the app (react-native-gesture-handler requirement),
// so the drawer's swipe gesture and the timetable's per-screen opt-out both work.
import 'react-native-gesture-handler';
import '@/i18n';

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

/**
 * One client for the app's lifetime. Defaults lean conservative because campus
 * wifi is unreliable and a refetch storm on a flaky connection is worse than
 * slightly stale data: no refetch on window focus, one retry, and per-query
 * staleTime set where it actually matters (see src/api/queries.ts).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

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
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemedStatusBar />
            <Slot />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
