import React from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import {
  SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH,
  useCourseSections, useEnrollments, useSearchCourses,
} from "@/api/queries";
import { useAddEnrollment, useDropEnrollment, useRecolourEnrollment } from "@/api/mutations";
import { ACCENT_COLORS, type AccentColor, type Enrollment } from "@/api/types";
import { ApiError } from "@/api/client";

/** The palette a student picks from. Names are `public.accent_color`. */
const SWATCH: Record<AccentColor, string> = {
  turquoise: "#0F7A85",
  bronze: "#C8952A",
  pomegranate: "#B23A2F",
  indigo: "#3B4E8C",
  ink: "#141C24",
  moss: "#4A6741",
  plum: "#6B3F62",
};

const WEEKDAYS = ["", "B.E", "Ç.A", "Ç", "C.A", "C", "Ş", "B"];

/**
 * Add, drop and recolour the courses on the week grid.
 *
 * **Enrollment hangs off the section, not the course**, so this is a two-step
 * pick: search the catalogue, then choose which section — because section 1 and
 * section 2 of the same course are two different weeks, and often two different
 * instructors. Each section shows its meetings before you commit, rather than
 * making you enroll to find out what you signed up for.
 *
 * **Dropping is not deleting.** The server moves the enrollment to `dropped`
 * and keeps the row, so the absence count survives — on a course where twelve
 * absences bar you from the exam, drop-and-re-add would otherwise reset the
 * counter. The confirmation says the course leaves the grid, which is what
 * actually happens, rather than promising an erasure that does not occur.
 */
export default function TimetableEditScreen() {
  const theme = useTheme();
  const { t } = useTranslation();

  const enrollments = useEnrollments();
  const add = useAddEnrollment();
  const drop = useDropEnrollment();
  const recolour = useRecolourEnrollment();

  const [raw, setRaw] = React.useState("");
  const [q, setQ] = React.useState("");
  const [openCourse, setOpenCourse] = React.useState<string | null>(null);
  const [colouring, setColouring] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setQ(raw.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  const results = useSearchCourses(q, q.length >= SEARCH_MIN_LENGTH, 10);
  const sections = useCourseSections(openCourse);
  const courseHits = results.data?.pages.flatMap((p) => p.items) ?? [];

  const explain = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : null;
    return code === "already_enrolled" ? t("timetable.editAlready")
      : code === "section_full" ? t("timetable.editFull")
      : code === "term_closed" ? t("timetable.editClosed")
      : t("timetable.editFailed");
  };

  const onAdd = (sectionId: string) => {
    setFailure(null);
    add.mutate({ sectionId }, {
      onSuccess: () => { setOpenCourse(null); setRaw(""); setQ(""); },
      onError: (e) => setFailure(explain(e)),
    });
  };

  const onDrop = (e: Enrollment) => {
    Alert.alert(
      t("timetable.editDropTitle", { code: e.course.code }),
      t("timetable.editDropBody"),
      [
        { text: t("timetable.editCancel"), style: "cancel" },
        {
          text: t("timetable.editDrop"),
          style: "destructive",
          onPress: () => {
            setFailure(null);
            drop.mutate(e.id, { onError: (err) => setFailure(explain(err)) });
          },
        },
      ],
    );
  };

  const label = (text: string) => (
    <Text style={[styles.label, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
      {text}
    </Text>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("timetable.editTitle") }} />

      {failure ? (
        <Text style={[styles.failure, { color: theme.colors.urgent }]}>{failure}</Text>
      ) : null}

      {/* ---------------- current courses ---------------- */}
      {label(t("timetable.editMine"))}
      {enrollments.isPending ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : (enrollments.data ?? []).length === 0 ? (
        <Text style={[styles.note, { color: theme.colors.textMuted }]}>{t("timetable.editNone")}</Text>
      ) : (
        (enrollments.data ?? []).map((e) => (
          <View
            key={e.id}
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <View style={styles.cardHead}>
              <Pressable
                onPress={() => setColouring(colouring === e.id ? null : e.id)}
                accessibilityRole="button"
                accessibilityLabel={t("timetable.editColour")}
                style={[styles.dot, { backgroundColor: SWATCH[e.color] }]}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: "700" }}>
                  {e.course.code}
                  <Text style={{ color: theme.colors.textMuted, fontWeight: "400" }}>
                    {`  ${t("timetable.editSection")} ${e.section_code}`}
                  </Text>
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={1}>
                  {e.course.title}
                </Text>
                {e.instructor_name ? (
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{e.instructor_name}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => onDrop(e)}
                disabled={drop.isPending}
                accessibilityRole="button"
                style={[styles.dropBtn, { borderColor: theme.colors.urgent }]}
              >
                <Text style={{ color: theme.colors.urgent, fontSize: 12, fontWeight: "600" }}>
                  {t("timetable.editDrop")}
                </Text>
              </Pressable>
            </View>

            {colouring === e.id ? (
              <View style={styles.swatchRow}>
                {ACCENT_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={c}
                    onPress={() => {
                      setFailure(null);
                      recolour.mutate({ enrollmentId: e.id, color: c },
                        { onSuccess: () => setColouring(null), onError: (err) => setFailure(explain(err)) });
                    }}
                    style={[
                      styles.swatch,
                      { backgroundColor: SWATCH[c] },
                      c === e.color ? { borderWidth: 3, borderColor: theme.colors.textPrimary } : null,
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))
      )}

      {/* ---------------- add a course ---------------- */}
      {label(t("timetable.editAdd"))}
      <TextInput
        value={raw}
        onChangeText={setRaw}
        placeholder={t("timetable.editSearchHint")}
        placeholderTextColor={theme.colors.textPlaceholder}
        autoCorrect={false}
        style={[styles.input, {
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        }]}
      />

      {q.length >= SEARCH_MIN_LENGTH && results.isFetching && !results.data ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : null}

      {courseHits.map((c) => {
        const open = openCourse === c.id;
        return (
          <View
            key={c.id}
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <Pressable onPress={() => setOpenCourse(open ? null : c.id)} accessibilityRole="button">
              <Text style={{ color: theme.colors.textPrimary, fontWeight: "700" }}>{c.code}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{c.title}</Text>
            </Pressable>

            {open ? (
              sections.isPending ? (
                <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 10 }} />
              ) : (sections.data ?? []).length === 0 ? (
                <Text style={[styles.note, { color: theme.colors.textMuted }]}>
                  {t("timetable.editNoSections")}
                </Text>
              ) : (
                (sections.data ?? []).map((s) => {
                  const full = s.capacity !== null && s.enrolled_count >= s.capacity;
                  const blocked = s.is_enrolled || full;
                  return (
                    <View key={s.id} style={[styles.section, { borderColor: theme.colors.borderLight }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: "600" }}>
                          {t("timetable.editSection")} {s.section_code}
                          {s.capacity !== null ? `  ·  ${s.enrolled_count}/${s.capacity}` : ""}
                        </Text>
                        {s.instructor_name ? (
                          <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{s.instructor_name}</Text>
                        ) : null}
                        {/* The week impact, before committing to it. */}
                        {s.meetings.map((m, i) => (
                          <Text
                            key={`${s.id}-${i}`}
                            style={{ color: theme.colors.textMuted, fontSize: 11, fontFamily: theme.fontFamilies.mono }}
                          >
                            {`${WEEKDAYS[m.weekday] ?? m.weekday}  ${m.starts_at}–${m.ends_at}`}
                            {m.room ? `  ${m.room}` : ""}
                          </Text>
                        ))}
                      </View>
                      <Pressable
                        disabled={blocked || add.isPending}
                        onPress={() => onAdd(s.id)}
                        accessibilityRole="button"
                        style={[styles.addBtn, {
                          backgroundColor: blocked ? theme.colors.border : theme.colors.primary,
                        }]}
                      >
                        <Text style={{
                          color: blocked ? theme.colors.textMuted : theme.colors.onPrimary,
                          fontSize: 12, fontWeight: "700",
                        }}>
                          {s.is_enrolled ? t("timetable.editAdded")
                            : full ? t("timetable.editFullShort")
                            : t("timetable.editAddBtn")}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })
              )
            ) : null}
          </View>
        );
      })}

      {q.length >= SEARCH_MIN_LENGTH && !results.isFetching && courseHits.length === 0 ? (
        <Text style={[styles.note, { color: theme.colors.textMuted }]}>{t("search.noResults")}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 56 },
  label: { fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", marginTop: 14 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  dot: { width: 22, height: 22, borderRadius: 11 },
  dropBtn: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 4 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  section: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 6,
  },
  addBtn: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  note: { fontSize: 12, lineHeight: 17 },
  failure: { fontSize: 13 },
});
