import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/** Stack inside the drawer, so listing detail pushes and Bazar stays active. */
export default function MarketLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="listing/[id]" />
      <Stack.Screen name="new" options={{ presentation: "modal" }} />
      <Stack.Screen name="chat/[id]" />
    </Stack>
  );
}
