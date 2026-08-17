import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A Stack inside the drawer, so board and post detail push on top of the list
 * while Forum stays the active drawer destination and the back stack works.
 * Per docs/03-navigation.md, detail routes must not swallow deep links or
 * strand the drawer.
 */
export default function ForumLayout() {
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
      {/* The list keeps the drawer's own header (hamburger); details get a back button. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="board/[slug]" />
      <Stack.Screen name="post/[id]" />
    </Stack>
  );
}
