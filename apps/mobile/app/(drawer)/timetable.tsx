import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useWeekGrid } from "@/api/queries";
import { ApiError, API_BASE_URL, hasAuthToken } from "@/api/client";
import { WeekGrid } from "@/features/timetable/WeekGrid";

export default function TimetableScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data, isPending, error, refetch } = useWeekGrid();

  if (isPending) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    // Errors here are almost always one of two operational states rather than
    // bugs, and each has a different thing the reader should do about it, so
    // they are worth distinguishing rather than showing one generic failure.
    const api = error instanceof ApiError ? error : null;
    const needsAuth = api?.status === 401 || !hasAuthToken();
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background, gap: 8 }]}>
        <Text style={[styles.errTitle, { color: theme.colors.textPrimary }]}>
          {needsAuth ? t("timetable.signInNeeded") : t("timetable.loadFailed")}
        </Text>
        <Text style={[styles.errBody, { color: theme.colors.textMuted }]}>
          {needsAuth ? t("timetable.signInHint") : (api?.message ?? String(error))}
        </Text>
        <Text
          style={[styles.errMeta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
          onPress={() => refetch()}
        >
          {API_BASE_URL}
        </Text>
      </View>
    );
  }

  if (data.meetings.length === 0) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background, gap: 6 }]}>
        <Text style={[styles.errTitle, { color: theme.colors.textPrimary }]}>
          {t("timetable.emptyTitle")}
        </Text>
        <Text style={[styles.errBody, { color: theme.colors.textMuted }]}>
          {t("timetable.emptyBody")}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={[styles.termBar, { borderBottomColor: theme.colors.border }]}>
        <Text
          style={[styles.term, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}
        >
          {data.term.label.toUpperCase()}
        </Text>
      </View>
      <WeekGrid meetings={data.meetings} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  errTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  errBody: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  errMeta: { fontSize: 10, marginTop: 8 },
  termBar: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  term: { fontSize: 10, letterSpacing: 1.4 },
});
