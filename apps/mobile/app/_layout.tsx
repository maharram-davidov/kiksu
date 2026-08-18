// Must be the first import in the app (react-native-gesture-handler requirement),
// so the drawer's swipe gesture and the timetable's per-screen opt-out both work.
import 'react-native-gesture-handler';
import '@/i18n';

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect, Slot, useSegments } from 'expo-router';
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
 * An unverified caller is sent to onboarding and kept there. The drawer's
 * routes are still mounted — Expo Router builds the tree from the filesystem,
 * not from this component — so this redirect is a navigation rule, not a
 * security boundary. It does not need to be one: every drawer screen's data
 * comes from the API, which authorises each request against the token, and a
 * caller with no `app_user` has no claims in that token. Reaching /today
 * without verifying gets you the screen's own empty state, not someone's
 * timetable.
 *
 * The redirect is skipped while already inside the (auth) group, or it would
 * fight the onboarding flow's own navigation on every step.
 */
function RootNavigator() {
  const { session } = useSession();
  const theme = useTheme();
  const segments = useSegments();

  const inAuthGroup = segments[0] === '(auth)';
  const needsOnboarding = session.status === 'anonymous';

  if (session.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (needsOnboarding && !inAuthGroup) {
    return <Redirect href="/(auth)/university" />;
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
