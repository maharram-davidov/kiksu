import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useToday } from "@/api/queries";
import type { TodayClass } from "@/api/types";

/**
 * The landing screen. One request, because this is what students open every
 * morning on campus wifi.
 *
 * Every time shown here is computed server-side in the UNIVERSITY's timezone.
 * Nothing on this screen constructs a Date from a class time: the phone's zone
 * is not the university's, and a student who has travelled would otherwise see
 * "45 dəq sonra" against a class that already happened.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isPending, error } = useToday();

  // Inline rather than a helper taking `t`: the i18n types are keyed to the
  // real key set, and passing `t` through a loosely-typed parameter would
  // discard exactly the checking that makes a missing translation a build
  // error instead of a runtime "today.inMinutes".
  const relativeLabel = (c: TodayClass): string =>
    c.is_in_progress
      ? t("today.inProgress")
      : t("today.inMinutes", { count: c.starts_in_minutes });

  if (isPending) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textMuted }}>{t("today.loadFailed")}</Text>
      </View>
    );
  }

  const label = (s: string) => (
    <Text style={[styles.sectionLabel, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
      {s.toUpperCase()}
    </Text>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 24 }}
    >
      <View style={{ gap: 10 }}>
        {label(`${t("today.remaining")} · ${data.remaining_classes.length}`)}
        {data.remaining_classes.length === 0 ? (
          <Text style={[styles.empty, { color: theme.colors.textPlaceholder }]}>
            {t("today.noClassesToday")}
          </Text>
        ) : (
          data.remaining_classes.map((c) => (
            <View
              key={`${c.section_id}-${c.starts_at}`}
              style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <View
                style={[
                  styles.stripe,
                  { backgroundColor: c.is_in_progress ? theme.colors.urgent : theme.colors.primary },
                ]}
              />
              <View style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {c.course_title}
                </Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                  {c.starts_at}–{c.ends_at}
                  {c.room ? ` · ${(c.campus ?? "").toUpperCase()} ${c.room}` : ""}
                </Text>
                {c.instructor ? (
                  <Text style={[styles.meta, { color: theme.colors.textPlaceholder }]}>{c.instructor}</Text>
                ) : null}
              </View>
              <Text
                style={[
                  styles.badge,
                  {
                    color: c.is_in_progress ? theme.colors.urgent : theme.colors.primary,
                    fontFamily: theme.fontFamilies.mono,
                  },
                ]}
              >
                {relativeLabel(c)}
              </Text>
            </View>
          ))
        )}
      </View>

      {data.deadlines.length > 0 ? (
        <View style={{ gap: 10 }}>
          {label(t("today.deadlines"))}
          {data.deadlines.map((d) => (
            <View
              key={d.id}
              style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <View style={[styles.stripe, { backgroundColor: theme.colors.urgent }]} />
              <View style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {d.title}
                </Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                  {d.course_code}
                </Text>
              </View>
              <Text style={[styles.badge, { color: theme.colors.urgent, fontFamily: theme.fontFamilies.mono }]}>
                {d.days_left === 0 ? t("today.today") : t("today.daysLeft", { count: d.days_left })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {data.hot_posts.length > 0 ? (
        <View style={{ gap: 10 }}>
          {label(t("today.hot"))}
          {data.hot_posts.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: "/forum/post/[id]", params: { id: p.id } })}
              style={({ pressed }) => [
                styles.postRow,
                {
                  backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text
                style={[styles.board, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
              >
                {p.board_name.toUpperCase()} · {p.comment_count} ▭
              </Text>
              <Text style={[styles.postTitle, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                {p.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4 },
  empty: { fontSize: 13, fontStyle: "italic" },
  card: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  stripe: { width: 3, alignSelf: "stretch" },
  title: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 11 },
  badge: { fontSize: 9, letterSpacing: 0.8, paddingRight: 12, textAlign: "right", maxWidth: 92 },
  postRow: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 4 },
  board: { fontSize: 9, letterSpacing: 0.9 },
  postTitle: { fontSize: 14, fontWeight: "600", lineHeight: 19 },
});
