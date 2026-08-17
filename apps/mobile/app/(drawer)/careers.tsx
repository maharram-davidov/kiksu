import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useVacancies } from "@/api/queries";

export default function CareersScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data, isPending, error } = useVacancies();

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
        <Text style={{ color: theme.colors.textMuted }}>{t("careers.loadFailed")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={data}
      keyExtractor={(v) => v.id}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <Text style={[styles.count, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
            {data.length} {t("careers.active").toUpperCase()}
          </Text>
          {/* Layer 4, stated where it matters. Applying is the one place a real
              name leaves the app, and a student deserves to know that before
              they tap, not in a settings screen they never open. */}
          <View style={[styles.notice, { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primaryAccent }]}>
            <Text style={[styles.noticeText, { color: theme.colors.primaryHover }]}>
              {t("careers.careerIdentity")}
            </Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.colors.textPlaceholder }]}>{t("careers.noVacancies")}</Text>
      }
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={styles.head}>
            <View style={[styles.logo, { backgroundColor: item.employer.brand_color ?? theme.colors.primary }]}>
              <Text style={[styles.logoText, { color: theme.colors.onPrimary, fontFamily: theme.fontFamilies.mono }]}>
                {item.employer.logo_initials ?? item.employer.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[styles.meta, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                {item.employer.name.toUpperCase()} · {(item.city ?? "").toUpperCase()} ·{" "}
                {item.work_mode.toUpperCase()}
              </Text>
            </View>
            {item.days_left !== null ? (
              <Text style={[styles.deadline, { color: theme.colors.urgent, fontFamily: theme.fontFamilies.mono }]}>
                {item.days_left} {t("careers.days")}
              </Text>
            ) : null}
          </View>

          <View style={styles.chips}>
            {item.duration_months ? (
              <Chip label={`${item.duration_months} ${t("careers.months")}`} />
            ) : null}
            {item.hours_per_week ? (
              <Chip label={`${item.hours_per_week} ${t("careers.hoursWeek")}`} />
            ) : null}
            {item.is_paid && item.stipend_minor ? (
              <Chip label={`${t("careers.paid").toUpperCase()} · ${item.stipend_minor / 100} ₼`} />
            ) : null}
            {item.min_study_year ? (
              <Chip label={`${item.min_study_year}–${item.max_study_year ?? item.min_study_year} ${t("careers.year")}`} />
            ) : null}
            {item.conversion_possible ? <Chip label={t("careers.conversion").toUpperCase()} /> : null}
            {item.transport_provided ? <Chip label={t("careers.transport").toUpperCase()} /> : null}
            {item.schedule_friendly ? <Chip label={t("careers.friendly").toUpperCase()} /> : null}
            {item.required_skills.map((s) => <Chip key={s} label={s.toUpperCase()} />)}
          </View>
        </View>
      )}
    />
  );

  function Chip({ label }: { label: string }) {
    return (
      <Text
        style={[
          styles.chip,
          {
            color: theme.colors.textMuted,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.borderLight,
            fontFamily: theme.fontFamilies.mono,
          },
        ]}
      >
        {label}
      </Text>
    );
  }
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  count: { fontSize: 10, letterSpacing: 1.2 },
  notice: { borderWidth: 1, borderRadius: 4, padding: 10 },
  noticeText: { fontSize: 11, lineHeight: 16 },
  empty: { fontSize: 13, textAlign: "center", marginTop: 40, fontStyle: "italic" },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 10 },
  head: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  logo: { width: 34, height: 34, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 11, fontWeight: "700" },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  meta: { fontSize: 9, letterSpacing: 0.7 },
  deadline: { fontSize: 10, letterSpacing: 0.6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { fontSize: 9, letterSpacing: 0.6, borderWidth: 1, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2 },
});
