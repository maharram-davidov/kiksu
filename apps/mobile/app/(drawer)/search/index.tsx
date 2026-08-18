import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import {
  SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH,
  useSearchCourses, useSearchInstructors, useSearchListings, useSearchPosts, useSearchVacancies,
} from "@/api/queries";
import type { SearchScope } from "@/api/types";
import { clearRecent, pushRecent, readRecent } from "@/features/search/recent-searches";
import {
  CourseHitRow, InstructorHitRow, ListingHitRow, PostHitRow, SectionLabel, VacancyHitRow,
} from "@/features/search/parts";

/**
 * Global search — HM-03, with HM-04, HM-05 and HM-06 as the result surfaces
 * behind its scope chips.
 *
 * **One route, not four.** The screen register lists the three result screens
 * separately, but they share a query field and a scope selector; making them
 * separate Expo Router destinations would drop the query on every chip tap and
 * push a back stack the student did not ask for. The chips switch the surface,
 * the query survives.
 *
 * **There is no People chip, and adding one is not a UI decision.** Identity
 * spec T11: handle lookup is exact-match, opt-in and rate-limited elsewhere,
 * because prefix or fuzzy matching over `sakit-pərvanə-37` enumerates the user
 * base along with each student's university and year. The empty state says so
 * in plain language rather than leaving the absence to be read as an oversight.
 *
 * **Trending is not built,** and the screen says that rather than filling the
 * space with something invented. See `recent-searches.ts` for why a server-side
 * query log is the wrong thing to build casually.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => { void readRecent().then(setRecent); }, []);

  // Debounced, because every keystroke would otherwise be a request against a
  // shared hourly bucket — see SEARCH_DEBOUNCE_MS.
  useEffect(() => {
    const id = setTimeout(() => setQ(raw.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  const active = q.length >= SEARCH_MIN_LENGTH;

  // Record the query only once it has settled and actually run. Recording on
  // keystroke would fill the list with every prefix the student typed through.
  useEffect(() => {
    if (active) void pushRecent(q).then(setRecent);
  }, [q, active]);

  const wantPosts = active && (scope === "all" || scope === "posts");
  const wantCourses = active && (scope === "all" || scope === "courses");
  const wantListings = active && (scope === "all" || scope === "listings");
  const wantVacancies = active && scope === "vacancies";

  // The "all" tab fans out across three corpora rather than hitting one
  // aggregate endpoint — the API has none, deliberately (assertion 21). Small
  // limits here keep the combined view readable and the bucket spend honest.
  const allLimit = scope === "all" ? 3 : 20;
  const posts = useSearchPosts(q, wantPosts, allLimit);
  const courses = useSearchCourses(q, wantCourses, allLimit);
  const instructors = useSearchInstructors(q, wantCourses, allLimit);
  const listings = useSearchListings(q, wantListings, allLimit);
  const vacancies = useSearchVacancies(q, wantVacancies, 20);

  const queries = [posts, courses, instructors, listings, vacancies];
  const isLoading = active && queries.some((r) => r.isFetching && !r.data);
  const failed = active && queries.some((r) => r.error) && !queries.some((r) => r.data);

  const total = useMemo(
    () =>
      (wantPosts ? posts.data?.items.length ?? 0 : 0) +
      (wantCourses ? (courses.data?.items.length ?? 0) + (instructors.data?.items.length ?? 0) : 0) +
      (wantListings ? listings.data?.items.length ?? 0 : 0) +
      (wantVacancies ? vacancies.data?.items.length ?? 0 : 0),
    [wantPosts, wantCourses, wantListings, wantVacancies,
     posts.data, courses.data, instructors.data, listings.data, vacancies.data],
  );

  const onClear = useCallback(() => { void clearRecent().then(() => setRecent([])); }, []);

  const chips: Array<{ key: SearchScope; label: string }> = [
    { key: "all", label: t("search.scopeAll") },
    { key: "posts", label: t("search.scopePosts") },
    { key: "courses", label: t("search.scopeCourses") },
    { key: "listings", label: t("search.scopeListings") },
    { key: "vacancies", label: t("search.scopeVacancies") },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: t("search.title") }} />

      <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          placeholder={t("search.placeholder")}
          placeholderTextColor={theme.colors.textPlaceholder}
          style={[styles.input, { color: theme.colors.textPrimary }]}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t("search.title")}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {chips.map((c) => {
          const on = scope === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setScope(c.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                  borderColor: on ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: on ? theme.colors.onPrimary : theme.colors.textSecondary,
                    fontFamily: theme.fontFamilies.mono },
                ]}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
        {!active ? (
          <View style={{ gap: 20 }}>
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t("search.hint")}</Text>

            {recent.length > 0 ? (
              <View style={{ gap: 8 }}>
                <View style={styles.recentHeader}>
                  <SectionLabel>{t("search.recent")}</SectionLabel>
                  <Pressable onPress={onClear} accessibilityRole="button">
                    <Text style={[styles.clear, { color: theme.colors.primary }]}>
                      {t("search.clearRecent")}
                    </Text>
                  </Pressable>
                </View>
                {recent.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setRaw(r)}
                    style={[styles.recentRow, { borderColor: theme.colors.borderLight }]}
                  >
                    <Text style={{ color: theme.colors.textSecondary }}>{r}</Text>
                  </Pressable>
                ))}
                <Text style={[styles.note, { color: theme.colors.textMuted }]}>
                  {t("search.recentLocalNote")}
                </Text>
              </View>
            ) : null}

            {/*
              Said plainly rather than left as a gap. Trending needs query
              logging, and a campus-scoped trending list can surface a query
              only a handful of students made.
            */}
            <Text style={[styles.note, { color: theme.colors.textMuted }]}>
              {t("search.trendingUnavailable")}
            </Text>

            <View style={[styles.notice, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderLight }]}>
              <Text style={[styles.noticeTitle, { color: theme.colors.textPrimary }]}>
                {t("search.noPeopleTitle")}
              </Text>
              <Text style={[styles.note, { color: theme.colors.textMuted }]}>
                {t("search.noPeopleBody")}
              </Text>
            </View>
          </View>
        ) : isLoading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 32 }} />
        ) : failed ? (
          <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t("search.failed")}</Text>
        ) : total === 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>
              {t("search.noResults")}
            </Text>
            <Text style={[styles.note, { color: theme.colors.textMuted }]}>
              {t("search.noResultsHint")}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 22 }}>
            {wantPosts && posts.data?.items.length ? (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("search.sectionPosts")}</SectionLabel>
                {posts.data.items.map((h) => (
                  <PostHitRow
                    key={h.id}
                    hit={h}
                    onPress={() => router.push({ pathname: "/forum/post/[id]", params: { id: h.id } })}
                  />
                ))}
              </View>
            ) : null}

            {wantCourses && courses.data?.items.length ? (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("search.sectionCourses")}</SectionLabel>
                {courses.data.items.map((h) => (
                  <CourseHitRow key={h.id} hit={h} onPress={() => router.push("/timetable")} />
                ))}
              </View>
            ) : null}

            {wantCourses && instructors.data?.items.length ? (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("search.sectionInstructors")}</SectionLabel>
                {instructors.data.items.map((h) => (
                  <InstructorHitRow
                    key={h.id}
                    hit={h}
                    onPress={() =>
                      router.push({ pathname: "/reviews/instructor/[id]", params: { id: h.id } })}
                  />
                ))}
              </View>
            ) : null}

            {wantListings && listings.data?.items.length ? (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("search.sectionListings")}</SectionLabel>
                {listings.data.items.map((h) => (
                  <ListingHitRow
                    key={h.id}
                    hit={h}
                    onPress={() =>
                      router.push({ pathname: "/market/listing/[id]", params: { id: h.id } })}
                  />
                ))}
              </View>
            ) : null}

            {wantVacancies && vacancies.data?.items.length ? (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("search.sectionVacancies")}</SectionLabel>
                {vacancies.data.items.map((h) => (
                  <VacancyHitRow key={h.id} hit={h} onPress={() => router.push("/careers")} />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBar: { margin: 16, marginBottom: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 },
  input: { height: 44, fontSize: 15 },
  chipRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  results: { padding: 16, paddingBottom: 48 },
  hint: { fontSize: 13, textAlign: "center", marginTop: 24 },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recentRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  clear: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 12, lineHeight: 17 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 6 },
  noticeTitle: { fontSize: 14, fontWeight: "600" },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
});
