import React from "react";
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A Stack inside the drawer, matching Forum and Bazar, so the editor pushes on
 * top of the week grid with a working back button while Cədvəl stays the active
 * drawer destination.
 *
 * The drawer's own `swipeEnabled: false` for this destination still applies and
 * still matters: the week grid scrolls horizontally, and the edge-swipe fights
 * it (docs/03-navigation.md).
 */
export default function TimetableLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontSize: 16 },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {/* The grid keeps the drawer's header (hamburger); the editor gets a back button. */}
      {/* `title` is set even though the header is hidden: the back button on
          pushed screens takes its label from the previous route, and without
          this it renders the literal filename, "index". */}
      <Stack.Screen name="index" options={{ headerShown: false, title: t("nav.timetable") }} />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
