// Must be the first import in the app (react-native-gesture-handler requirement),
// so the drawer's swipe gesture and the timetable's per-screen opt-out both work.
import 'react-native-gesture-handler';
import '@/i18n';

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { SessionProvider, useSession } from '@/session/session';

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
/**
 * Routes between onboarding and the app.
 *
 * The drawer mounts only once a session is verified, so there is no way to
 * reach the app's contents by dismissing a signup screen — the routes simply
 * are not there yet.
 *
 * NOTE: while the development auth bypass is active the API already treats
 * every request as a seeded student, so the app skips straight to the drawer.
 * Onboarding is reachable at /(auth)/university to walk it deliberately. Once
 * Supabase Auth is wired this becomes an unconditional redirect on
 * `status !== 'verified'`.
 */
function RootNavigator() {
  const { session } = useSession();
  const theme = useTheme();

  if (session.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SessionProvider>
              <ThemedStatusBar />
              <RootNavigator />
            </SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
