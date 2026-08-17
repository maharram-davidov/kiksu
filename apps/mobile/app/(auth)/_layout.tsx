import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Onboarding renders OUTSIDE the drawer entirely — no drawer, no gesture, no
 * hamburger — per docs/03-navigation.md. The drawer mounts only once
 * verification completes, so there is no way to reach the app's contents by
 * swiping past a signup screen.
 */
export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
