import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Search is a route group, not a drawer destination — the same arrangement as
 * Reviews, and for the same reason: docs/03-navigation.md settles the drawer at
 * six items, and search is reached from the header icon on Forum and Bazar
 * rather than from the drawer. The entry that hides it lives in ../_layout.tsx.
 */
export default function SearchLayout() {
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
      <Stack.Screen name="index" />
    </Stack>
  );
}
