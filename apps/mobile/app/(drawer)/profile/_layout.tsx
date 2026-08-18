import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A Stack inside the drawer, matching Forum, Bazar and Rəylər, so "Məzmunum"
 * pushes over the profile with a working back button while Profil stays the
 * active drawer destination.
 */
export default function ProfileLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontSize: 16 },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {/* The profile keeps the drawer's own header (hamburger); details get a back button. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="moderation" />
    </Stack>
  );
}
