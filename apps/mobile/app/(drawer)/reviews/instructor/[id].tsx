import React from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useInstructor, useInstructorReviews } from "@/api/queries";
import { CriterionBar, Histogram, ReviewCard, Stars, TagChips } from "@/features/reviews/parts";

/**
 * The professor profile (design screen 07, RV-02 + RV-04 + RV-07).
 *
 * The screen is split by what the contribution wall gates and what it does
 * not, and that split is the design's, not an implementation detail:
 * everything above "Yazılı rəylər" — the average, the histogram, the criteria,
 * the tags — is visible to every student unconditionally, because a rating
 * summary is what makes writing a review worth doing. Only the prose is
 * behind the wall.
 *
 * NO REVIEW CARRIES AN AUTHOR. Not a handle, not an ordinal, not a tier —
 * `Review` has no field for one and none is synthesised here. A course cohort
 * is small enough that even "Anonim 3, spring term" narrows to a few people,
 * which is why reviews are stricter than forum posts about this.
 */
export default function InstructorReviewsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [courseId, setCourseId] = React.useState<string | null>(null);
  const { data: profile, isPending, isError } = useInstructor(id ?? null);
  const { data: page } = useInstructorReviews(id ?? null, courseId);

  if (isPending) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textMuted }}>{t("reviews.noReviews")}</Text>
      </View>
    );
  }

  const initials = profile.full_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const access = page?.access;
  const locked = access ? !access.can_read_text : false;

  return (
    <>
      <Stack.Screen options={{ title: t("reviews.title") }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
      >
        {/* ---- identity ---- */}
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primaryLight }]}>
            <Text style={[styles.avatarText, { color: theme.colors.primary }]}>{initials}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: theme.colors.textPrimary }]}>
              {[profile.title_prefix, profile.full_name].filter(Boolean).join(" ")}
            </Text>
            <Text
              style={[styles.dept, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
            >
              {[profile.department, profile.university_code]
                .filter(Boolean)
                .join(" · ")
                .toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ---- the summary the wall never hides ---- */}
        <View style={[styles.block, { borderColor: theme.colors.borderLight, backgroundColor: theme.colors.surface }]}>
          <View style={styles.scoreRow}>
            <View>
              <Text style={[styles.score, { color: theme.colors.textPrimary }]}>
                {profile.rating_avg === null ? "—" : profile.rating_avg.toFixed(1)}
              </Text>
              <Stars value={profile.rating_avg ?? 0} size={14} />
              <Text
                style={[styles.counts, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
              >
                {t("reviews.reviewCount", { count: profile.review_count }).toUpperCase()} ·{" "}
                {t("reviews.courseCount", { count: profile.course_count }).toUpperCase()}
              </Text>
            </View>
            <View style={styles.histWrap}>
              <Histogram counts={profile.histogram} />
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {t("reviews.criteria").toUpperCase()}
        </Text>
        <View style={[styles.block, { borderColor: theme.colors.borderLight, backgroundColor: theme.colors.surface }]}>
          <CriterionBar label={t("reviews.quality")} value={profile.criteria.quality} />
          <CriterionBar label={t("reviews.fairness")} value={profile.criteria.fairness} />
          <CriterionBar label={t("reviews.workload")} value={profile.criteria.workload} />
          <CriterionBar label={t("reviews.attendance")} value={profile.criteria.attendance_strictness} />
          <TagChips tags={profile.top_tags} />
        </View>

        {/* ---- course filter (design: "FƏNN: CS 214 ▾") ---- */}
        {profile.courses.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <FilterChip
              label={t("reviews.allCourses")}
              active={courseId === null}
              onPress={() => setCourseId(null)}
            />
            {profile.courses.map((c) => (
              <FilterChip
                key={c.id}
                label={c.code}
                active={courseId === c.id}
                onPress={() => setCourseId(c.id)}
              />
            ))}
          </ScrollView>
        ) : null}

        {/* ---- written reviews, or the wall ---- */}
        <Text style={[styles.sectionLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {t("reviews.written").toUpperCase()}
        </Text>

        {locked && access ? (
          // A prompt, never an error. The API returns 200 with an empty list
          // precisely so this can be a bargain the student chooses to take
          // rather than a door they walked into.
          <View style={[styles.wall, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight }]}>
            <Text style={[styles.wallTitle, { color: theme.colors.textPrimary }]}>
              {t("reviews.wallTitle")}
            </Text>
            <Text style={[styles.wallBody, { color: theme.colors.textSecondary }]}>
              {t("reviews.wallBody", {
                written: access.written_this_term,
                required: access.required_this_term,
              })}
            </Text>
          </View>
        ) : page && page.items.length === 0 ? (
          <Text style={[styles.empty, { color: theme.colors.textMuted }]}>{t("reviews.noReviews")}</Text>
        ) : (
          <View style={styles.list}>
            {page?.items.map((r) => <ReviewCard key={r.id} review={r} />)}
          </View>
        )}

        <Pressable
          onPress={() => router.push("/reviews/write")}
          style={[styles.cta, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={[styles.ctaText, { color: theme.colors.onPrimary }]}>
            {locked ? t("reviews.wallCta") : t("reviews.write")}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function FilterChip({
  label, active, onPress,
}: {
  label: string; active: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.filterChip,
        {
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primaryLight : "transparent",
        },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          {
            color: active ? theme.colors.primary : theme.colors.textSecondary,
            fontFamily: theme.fontFamilies.mono,
          },
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, fontWeight: "700" },
  headerText: { flex: 1, gap: 3 },
  name: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  dept: { fontSize: 10, letterSpacing: 0.8 },

  block: { borderWidth: 1, borderRadius: 6, padding: 14 },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  score: { fontSize: 34, fontWeight: "700", letterSpacing: -1 },
  counts: { fontSize: 9.5, letterSpacing: 0.7, marginTop: 6 },
  histWrap: { flex: 1, maxWidth: 170 },

  sectionLabel: { fontSize: 10, letterSpacing: 1.2, marginTop: 6 },

  filterRow: { gap: 6, paddingVertical: 2 },
  filterChip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5 },
  filterChipText: { fontSize: 10, letterSpacing: 0.6 },

  wall: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 6 },
  wallTitle: { fontSize: 15, fontWeight: "700" },
  wallBody: { fontSize: 13, lineHeight: 19 },

  empty: { fontSize: 13, paddingVertical: 12 },
  list: { gap: 10 },

  cta: { borderRadius: 6, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  ctaText: { fontSize: 15, fontWeight: "600" },
});
