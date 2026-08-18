import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import type { Review, ReviewTag } from "@/api/types";

/**
 * The pieces of design screen 07, kept out of the screen file because the
 * composer reuses the rating and tag controls.
 */

/** A 1–5 score as filled stars. Read-only. */
export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  const theme = useTheme();
  const rounded = Math.round(value);
  return (
    <Text style={{ fontSize: size, color: theme.colors.secondary, letterSpacing: 1 }}>
      {"★".repeat(rounded)}
      <Text style={{ color: theme.colors.borderLight }}>{"★".repeat(5 - rounded)}</Text>
    </Text>
  );
}

/**
 * The design's five-bar distribution, widest bar first (5 stars at the top).
 *
 * Bars are scaled against the largest bucket rather than the total, because
 * against the total a realistic distribution renders as five near-invisible
 * slivers — the shape is the information here, not the absolute proportion.
 */
export function Histogram({ counts }: { counts: number[] }) {
  const theme = useTheme();
  const max = Math.max(1, ...counts);
  return (
    <View style={styles.histogram}>
      {[5, 4, 3, 2, 1].map((star) => {
        const n = counts[star - 1] ?? 0;
        return (
          <View key={star} style={styles.histRow}>
            <Text
              style={[styles.histStar, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
            >
              {star}
            </Text>
            <View style={[styles.histTrack, { backgroundColor: theme.colors.borderLight }]}>
              <View
                style={[
                  styles.histFill,
                  { width: `${(n / max) * 100}%`, backgroundColor: theme.colors.primary },
                ]}
              />
            </View>
            <Text
              style={[styles.histCount, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
            >
              {n}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** One criterion with its average, as the design's "Meyarlar üzrə" block. */
export function CriterionBar({ label, value }: { label: string; value: number | null }) {
  const theme = useTheme();
  return (
    <View style={styles.critRow}>
      <Text style={[styles.critLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.critTrack, { backgroundColor: theme.colors.borderLight }]}>
        <View
          style={[
            styles.critFill,
            {
              width: `${((value ?? 0) / 5) * 100}%`,
              backgroundColor: theme.colors.primary,
            },
          ]}
        />
      </View>
      <Text
        style={[styles.critValue, { color: theme.colors.textPrimary, fontFamily: theme.fontFamilies.mono }]}
      >
        {value === null ? "—" : value.toFixed(1)}
      </Text>
    </View>
  );
}

/**
 * Tag chips. Colour carries polarity, which is the whole point of the field —
 * a negative tag rendered in the same neutral grey as a positive one tells the
 * reader nothing they could not get from the prose they may not be able to see.
 */
export function TagChips({
  tags,
  selected,
  onToggle,
}: {
  tags: ReviewTag[];
  selected?: string[];
  onToggle?: (key: string) => void;
}) {
  const theme = useTheme();
  if (tags.length === 0) return null;

  return (
    <View style={styles.chips}>
      {tags.map((tag) => {
        const isSelected = selected?.includes(tag.key) ?? false;
        const negative = tag.polarity === "negative";
        const tint = negative ? theme.colors.urgent : theme.colors.primary;
        const wash = negative ? theme.colors.urgentLight : theme.colors.primaryLight;
        return (
          <Pressable
            key={tag.key}
            disabled={!onToggle}
            onPress={() => onToggle?.(tag.key)}
            style={[
              styles.chip,
              {
                backgroundColor: onToggle && !isSelected ? "transparent" : wash,
                borderColor: onToggle && !isSelected ? theme.colors.border : tint,
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: onToggle && !isSelected ? theme.colors.textSecondary : tint,
                  fontFamily: theme.fontFamilies.mono,
                },
              ]}
            >
              {tag.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One written review.
 *
 * Carries NO author affordance of any kind — the header is the fixed string
 * "ANONİM · DOĞRULANMIŞ", derived from `is_enrollment_verified`, never an
 * identifier. `Review` has no author field for the API to send and none may be
 * invented here: a course cohort is small enough that even an ordinal would
 * narrow to a handful of people.
 */
export function ReviewCard({ review }: { review: Review }) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.card, { borderColor: theme.colors.borderLight, backgroundColor: theme.colors.surface }]}>
      <View style={styles.cardTop}>
        <Stars value={review.overall_rating} />
        <Text
          style={[styles.cardMeta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
        >
          {review.term_label.toUpperCase()} · {review.course_code}
        </Text>
      </View>

      <Text
        style={[styles.cardAuthor, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
      >
        {t("reviews.anonymous")}
        {review.is_enrollment_verified ? ` · ${t("reviews.verified")}` : ""}
      </Text>

      {review.body ? (
        <Text style={[styles.cardBody, { color: theme.colors.textPrimary }]}>{review.body}</Text>
      ) : null}

      {review.tags.length > 0 ? <TagChips tags={review.tags} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  histogram: { gap: 4 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  histStar: { fontSize: 10, width: 10 },
  histTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  histFill: { height: 6, borderRadius: 3 },
  histCount: { fontSize: 10, width: 24, textAlign: "right" },

  critRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  critLabel: { fontSize: 13, flex: 1 },
  critTrack: { width: 92, height: 6, borderRadius: 3, overflow: "hidden" },
  critFill: { height: 6, borderRadius: 3 },
  critValue: { fontSize: 12, width: 28, textAlign: "right" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 9.5, letterSpacing: 0.6 },

  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardMeta: { fontSize: 9.5, letterSpacing: 0.6 },
  cardAuthor: { fontSize: 9.5, letterSpacing: 0.8 },
  cardBody: { fontSize: 14, lineHeight: 21, marginTop: 2 },
});
