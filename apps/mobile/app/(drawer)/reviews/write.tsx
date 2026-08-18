import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useReviewable, useReviewTags } from "@/api/queries";
import { useWriteReview } from "@/api/mutations";
import { TagChips } from "@/features/reviews/parts";
import type { Reviewable } from "@/api/types";

/** The controller caps this at 6; enforcing it here avoids a round trip to learn so. */
const MAX_TAGS = 6;
const MAX_BODY = 2000;

const CRITERIA = [
  { key: "quality", label: "reviews.quality" },
  { key: "fairness", label: "reviews.fairness" },
  { key: "workload", label: "reviews.workload" },
  { key: "attendance_strictness", label: "reviews.attendance" },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];

/**
 * Write a review (RV-05 + RV-06).
 *
 * The structured half is required and the prose is not, which mirrors the
 * server's reasoning rather than being a UI preference: an average of numeric
 * ratings is what the product can defend if a professor objects, and the
 * paragraph is what students actually come to read. Ordering the form that way
 * — ratings first, prose last and marked optional — means the defensible part
 * is the part everyone completes.
 *
 * The course picker is driven by `/reviews/reviewable`, NOT by the instructor
 * profile, because the profile only lists courses that already have reviews.
 * Driving it from there would offer an empty picker for exactly the instructor
 * whose first review this is meant to be.
 */
export default function WriteReviewScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const { data: options, isPending: loadingOptions } = useReviewable();
  const { data: tags } = useReviewTags();
  const write = useWriteReview();

  const [picked, setPicked] = React.useState<Reviewable | null>(null);
  const [overall, setOverall] = React.useState(0);
  const [scores, setScores] = React.useState<Record<CriterionKey, number>>({
    quality: 0, fairness: 0, workload: 0, attendance_strictness: 0,
  });
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Auto-select when there is exactly one thing to review, which is the common
  // case for a student prompted from a single class.
  React.useEffect(() => {
    if (!picked && options?.length === 1) setPicked(options[0]!);
  }, [options, picked]);

  const complete =
    picked !== null && overall > 0 && CRITERIA.every(({ key }) => scores[key] > 0);

  const toggleTag = (key: string) => {
    setSelectedTags((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length >= MAX_TAGS
          ? prev
          : [...prev, key],
    );
  };

  const submit = () => {
    if (!complete || !picked) {
      setError(t("reviews.ratingRequired"));
      return;
    }
    setError(null);
    write.mutate(
      {
        course_id: picked.course_id,
        instructor_id: picked.instructor_id,
        overall_rating: overall,
        quality: scores.quality,
        fairness: scores.fairness,
        workload: scores.workload,
        attendance_strictness: scores.attendance_strictness,
        tags: selectedTags,
        // Empty prose is omitted rather than sent as "", so a review with no
        // text is genuinely null server-side instead of an empty string that
        // renders as a blank card.
        ...(body.trim() ? { body: body.trim() } : {}),
      },
      {
        onSuccess: () => router.replace(`/reviews/instructor/${picked.instructor_id}`),
        onError: () => setError(t("reviews.failed")),
      },
    );
  };

  if (loadingOptions) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!options || options.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: t("reviews.write") }} />
        <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
          <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
            {t("reviews.noReviewable")}
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("reviews.write") }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ backgroundColor: theme.colors.background }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.note, { color: theme.colors.textMuted }]}>
            {t("reviews.anonymousNote")}
          </Text>

          {/* ---- what is being reviewed ---- */}
          <Text style={[styles.label, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            {t("reviews.pickCourse").toUpperCase()}
          </Text>
          <View style={styles.options}>
            {options.map((o) => {
              const active =
                picked?.course_id === o.course_id && picked?.instructor_id === o.instructor_id;
              return (
                <Pressable
                  key={`${o.course_id}:${o.instructor_id}`}
                  onPress={() => setPicked(o)}
                  style={[
                    styles.option,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.borderLight,
                      backgroundColor: active ? theme.colors.primaryLight : theme.colors.surface,
                    },
                  ]}
                >
                  <Text style={[styles.optionCode, { color: theme.colors.textPrimary }]}>
                    {o.course_code} · {o.course_title}
                  </Text>
                  <Text
                    style={[styles.optionMeta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
                  >
                    {o.instructor_name.toUpperCase()} · {o.term_label.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ---- the required half ---- */}
          <Text style={[styles.label, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            {t("reviews.overall").toUpperCase()}
          </Text>
          <StarPicker value={overall} onChange={setOverall} />

          {CRITERIA.map(({ key, label }) => (
            <View key={key} style={styles.criterion}>
              <Text style={[styles.criterionLabel, { color: theme.colors.textSecondary }]}>{t(label)}</Text>
              <StarPicker value={scores[key]} onChange={(v) => setScores((s) => ({ ...s, [key]: v }))} />
            </View>
          ))}

          {/* ---- tags ---- */}
          {tags && tags.length > 0 ? (
            <>
              <Text style={[styles.label, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                {t("reviews.tags").toUpperCase()} · {t("reviews.tagsHint")}
              </Text>
              <TagChips tags={tags} selected={selectedTags} onToggle={toggleTag} />
            </>
          ) : null}

          {/* ---- the optional half ---- */}
          <Text style={[styles.label, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            {t("reviews.bodyLabel").toUpperCase()}
          </Text>
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t("reviews.bodyHint")}</Text>
          <TextInput
            value={body}
            onChangeText={(v) => setBody(v.slice(0, MAX_BODY))}
            multiline
            textAlignVertical="top"
            style={[
              styles.input,
              {
                color: theme.colors.textPrimary,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              },
            ]}
          />

          {error ? <Text style={[styles.error, { color: theme.colors.urgent }]}>{error}</Text> : null}

          <Pressable
            disabled={!complete || write.isPending}
            onPress={submit}
            style={[
              styles.submit,
              { backgroundColor: !complete || write.isPending ? theme.colors.borderLight : theme.colors.primary },
            ]}
          >
            {write.isPending ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : (
              <Text style={[styles.submitText, { color: theme.colors.onPrimary }]}>
                {t("reviews.submit")}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/** Five tappable stars. 0 means unset, which is what blocks submission. */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
          <Text
            style={{
              fontSize: 26,
              color: n <= value ? theme.colors.secondary : theme.colors.borderLight,
            }}
          >
            ★
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  content: { padding: 16, paddingBottom: 48, gap: 8 },

  note: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  label: { fontSize: 10, letterSpacing: 1.2, marginTop: 12 },
  hint: { fontSize: 12, lineHeight: 17 },

  options: { gap: 8 },
  option: { borderWidth: 1, borderRadius: 6, padding: 12, gap: 4 },
  optionCode: { fontSize: 14, fontWeight: "600" },
  optionMeta: { fontSize: 9.5, letterSpacing: 0.6 },

  stars: { flexDirection: "row", gap: 8 },
  criterion: { marginTop: 10, gap: 4 },
  criterionLabel: { fontSize: 13 },

  input: {
    borderWidth: 1, borderRadius: 6, padding: 12, minHeight: 120,
    fontSize: 14, lineHeight: 20, marginTop: 4,
  },
  error: { fontSize: 12, marginTop: 6 },
  submit: { borderRadius: 6, paddingVertical: 15, alignItems: "center", marginTop: 16 },
  submitText: { fontSize: 15, fontWeight: "600" },
});
