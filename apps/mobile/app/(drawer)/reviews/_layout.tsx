import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A Stack inside the drawer, matching Forum and Bazar, so the profile and the
 * composer push and pop with a working back button.
 *
 * Reviews are reached from the class detail sheet and from search — never from
 * the drawer. The product plan is explicit that reviews do not get a
 * destination of their own: they are a lookup tool used intensely for two
 * weeks at course registration and barely at all otherwise, so they belong
 * where the student is already choosing courses. The drawer entry that hides
 * this group lives in ../_layout.tsx.
 */
export default function ReviewsLayout() {
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
      <Stack.Screen name="instructor/[id]" />
      <Stack.Screen name="write" />
    </Stack>
  );
}
