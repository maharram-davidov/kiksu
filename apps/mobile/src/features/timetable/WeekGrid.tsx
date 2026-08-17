import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import type { Meeting } from "@/api/types";

/** Azerbaijani weekday abbreviations, ISO order: 1 = Monday. */
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/**
 * The week grid.
 *
 * Meetings arrive already ordered by weekday then start time, so this only
 * buckets them — no sorting, no per-cell lookups. The server sends wall-clock
 * strings plus the university's timezone rather than instants, so nothing here
 * constructs a Date: doing so would reinterpret 14:05 in the phone's zone and
 * silently shift every class for a student travelling.
 */
export function WeekGrid({
  meetings, onSelect,
}: {
  meetings: Meeting[];
  onSelect?: (sectionId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const byDay = new Map<number, Meeting[]>();
  for (const m of meetings) {
    const list = byDay.get(m.weekday);
    if (list) list.push(m);
    else byDay.set(m.weekday, [m]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[4], gap: theme.spacing[5] }}>
      {DAY_KEYS.map((key, i) => {
        const weekday = i + 1;
        const dayMeetings = byDay.get(weekday) ?? [];
        return (
          <View key={key} style={{ gap: theme.spacing[2] }}>
            <Text
              style={[
                styles.dayLabel,
                { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono },
              ]}
            >
              {t(`timetable.days.${key}`)}
            </Text>

            {dayMeetings.length === 0 ? (
              <Text style={[styles.free, { color: theme.colors.textPlaceholder }]}>
                {t("timetable.noClasses")}
              </Text>
            ) : (
              dayMeetings.map((m) => (
                <Pressable
                  key={`${m.section_id}-${m.starts_at}`}
                  onPress={() => onSelect?.(m.section_id)}
                  style={({ pressed }) => [
                    styles.card,
                    {
                      backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
                      borderColor: theme.colors.border,
                    },
                  ]}
                >
                  <View style={[styles.stripe, { backgroundColor: theme.colors.primary }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                      {m.course_title}
                    </Text>
                    <Text
                      style={[
                        styles.meta,
                        { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono },
                      ]}
                    >
                      {m.starts_at}–{m.ends_at}
                      {m.room ? ` · ${m.campus ?? ""} ${m.room}`.toUpperCase() : ""}
                    </Text>
                    {m.instructor ? (
                      <Text style={[styles.meta, { color: theme.colors.textPlaceholder }]}>
                        {m.instructor}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dayLabel: { fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase" },
  free: { fontSize: 13, fontStyle: "italic" },
  card: { flexDirection: "row", borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  stripe: { width: 3 },
  title: { fontSize: 15, fontWeight: "600", paddingTop: 10, paddingHorizontal: 12 },
  meta: { fontSize: 11, paddingHorizontal: 12, paddingBottom: 2 },
});
