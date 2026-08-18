import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import type { CourseHit, InstructorHit, ListingHit, PostHit, VacancyHit } from "@/api/types";

/**
 * Result rows for HM-04 – HM-06.
 *
 * Each corpus gets a row that shows what someone deciding whether to tap needs
 * and nothing more. The one rule that is not taste: a post row renders an
 * alias and never a handle, a listing row renders a handle and never an alias.
 * They live in the same file because that pairing is easier to keep honest
 * when both are visible at once.
 */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles.sectionLabel,
        { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono },
      ]}
    >
      {children}
    </Text>
  );
}

function Card({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function PostHitRow({ hit, onPress }: { hit: PostHit; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Card onPress={onPress}>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
          {hit.board.name}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
          {hit.scope === "national" ? t("search.national") : t("search.campus")}
        </Text>
      </View>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {hit.title}
      </Text>
      {hit.excerpt ? (
        <Text style={[styles.body, { color: theme.colors.textSecondary }]} numberOfLines={2}>
          {hit.excerpt}
        </Text>
      ) : null}
      {/*
        An ordinal and a coarse tier. Deliberately no handle and no author
        link: the alias is scoped to this thread and joining two of them to one
        person is exactly what Layer 3 exists to prevent.
      */}
      <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
        {`Anonim ${hit.author.alias_number}`}
        {hit.author.tier === "card" ? " · KART" : hit.author.tier === "email" ? " · ✓" : ""}
        {`  ·  ${hit.score}  ·  ${hit.comment_count}`}
      </Text>
    </Card>
  );
}

function Rating({ avg, count }: { avg: number | null; count: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (avg === null || count === 0) {
    return (
      <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
        {t("search.noRating")}
      </Text>
    );
  }
  return (
    <Text style={[styles.meta, { color: theme.colors.secondary, fontFamily: theme.fontFamilies.mono }]}>
      {`★ ${avg.toFixed(2)}  ·  ${t("search.reviewCount", { count })}`}
    </Text>
  );
}

export function CourseHitRow({ hit, onPress }: { hit: CourseHit; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Card onPress={onPress}>
      <Text style={[styles.meta, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
        {hit.code}
        {hit.credits !== null ? ` · ${hit.credits} KREDİT` : ""}
      </Text>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {hit.title}
      </Text>
      <Rating avg={hit.rating_avg} count={hit.review_count} />
    </Card>
  );
}

export function InstructorHitRow({ hit, onPress }: { hit: InstructorHit; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Card onPress={onPress}>
      {/* Instructor names are real and public — this is a review product, and
          an instructor is never an app_user. */}
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>
        {hit.title_prefix ? `${hit.title_prefix} ` : ""}
        {hit.full_name}
      </Text>
      {hit.department ? (
        <Text style={[styles.body, { color: theme.colors.textSecondary }]} numberOfLines={1}>
          {hit.department}
        </Text>
      ) : null}
      <Rating avg={hit.rating_avg} count={hit.review_count} />
    </Card>
  );
}

/** 2500 → "25 ₼". Minor units are converted exactly once, here, at render. */
function money(minor: number, currency: string): string {
  const major = minor / 100;
  const text = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return currency === "AZN" ? `${text} ₼` : `${text} ${currency}`;
}

export function ListingHitRow({ hit, onPress }: { hit: ListingHit; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Card onPress={onPress}>
      <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
        {hit.category_name}
        {hit.related_course_code ? ` · ${hit.related_course_code}` : ""}
      </Text>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {hit.title}
      </Text>
      <Text style={[styles.price, { color: theme.colors.primary }]}>
        {money(hit.price_minor, hit.currency)}
      </Text>
      {/* The seller's handle. Layer 2, and correct here: the marketplace is
          handle-attributed on purpose, because a seller with no persistent
          reputation is a scam waiting to happen. */}
      {hit.seller ? (
        <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
          {hit.seller.handle}
        </Text>
      ) : null}
    </Card>
  );
}

export function VacancyHitRow({ hit, onPress }: { hit: VacancyHit; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Card onPress={onPress}>
      <Text style={[styles.meta, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
        {hit.employer.name}
        {hit.city ? ` · ${hit.city}` : ""}
      </Text>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {hit.title}
      </Text>
      <View style={styles.metaRow}>
        {hit.is_paid && hit.stipend_minor !== null ? (
          <Text style={[styles.meta, { color: theme.colors.textSecondary, fontFamily: theme.fontFamilies.mono }]}>
            {money(hit.stipend_minor, hit.currency)}
          </Text>
        ) : null}
        {hit.days_left !== null ? (
          <Text style={[styles.meta, { color: theme.colors.urgent, fontFamily: theme.fontFamilies.mono }]}>
            {`${hit.days_left} GÜN`}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 6 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase" },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 11, letterSpacing: 0.5 },
  price: { fontSize: 15, fontWeight: "700" },
});
