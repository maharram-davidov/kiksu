import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useListing } from "@/api/queries";
import { ReportSheet } from "@/features/moderation/ReportSheet";

/** Minor units to a display string. 2500 -> "25 ₼". */
function formatPrice(minor: number): string {
  const major = minor / 100;
  return `${Number.isInteger(major) ? major : major.toFixed(2)} ₼`;
}

export default function ListingDetailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, error } = useListing(id);
  const [reporting, setReporting] = React.useState(false);

  if (isPending) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textMuted }}>{t("listing.loadFailed")}</Text>
      </View>
    );
  }

  const conditionLabel = ({
    new: t("listing.conditionNew"),
    like_new: t("listing.conditionLikeNew"),
    good: t("listing.conditionGood"),
    fair: t("listing.conditionFair"),
    poor: t("listing.conditionPoor"),
  } as Record<string, string>)[data.condition] ?? data.condition;

  const seller = data.seller;

  return (
    <>
      <Stack.Screen options={{ title: data.category_name }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}
      >
        {/* Photo gallery. Uploads are not built, so this states that rather
            than showing a broken image frame. */}
        <View style={[styles.gallery, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
          <Text style={[styles.galleryText, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            {t("listing.noPhotos").toUpperCase()}
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{data.title}</Text>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: theme.colors.textPrimary }]}>
              {formatPrice(data.price_minor)}
            </Text>
            {data.is_negotiable ? (
              <Text style={[styles.chip, { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderLight, fontFamily: theme.fontFamilies.mono }]}>
                {t("market.negotiable").toUpperCase()}
              </Text>
            ) : null}
          </View>

          <View style={styles.chips}>
            <Text style={[styles.chip, { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderLight, fontFamily: theme.fontFamilies.mono }]}>
              {t("listing.condition").toUpperCase()}: {conditionLabel.toUpperCase()}
            </Text>
            {data.related_course_code ? (
              <Text style={[styles.chip, { color: theme.colors.primary, backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primaryAccent, fontFamily: theme.fontFamilies.mono }]}>
                {data.related_course_code}
              </Text>
            ) : null}
          </View>
        </View>

        {data.description ? (
          <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
            {data.description}
          </Text>
        ) : null}

        {data.meetup_notes.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={[styles.label, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
              {t("listing.meetup").toUpperCase()}
            </Text>
            {data.meetup_notes.map((m) => (
              <Text key={m} style={[styles.meetup, { color: theme.colors.textSecondary }]}>{m}</Text>
            ))}
          </View>
        ) : null}

        {/* The seller card. This is the one place in Kiksu where a pseudonym
            carries a track record, and it is deliberate: someone about to meet
            a stranger and hand over cash needs something to go on. */}
        {seller ? (
          <View style={[styles.seller, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.sellerHead}>
              <View style={[styles.avatar, { backgroundColor: theme.colors.primaryLight }]}>
                <Text style={[styles.avatarText, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
                  {seller.avatar_id}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.handle, { color: theme.colors.textPrimary }]}>
                  {seller.handle}
                  {seller.verification_status === "card" ? " ✓" : ""}
                </Text>
                {seller.university_code ? (
                  <Text style={[styles.sellerUni, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                    {seller.university_code}
                  </Text>
                ) : null}
              </View>
              {seller.trade_rating_avg !== null ? (
                <Text style={[styles.rating, { color: theme.colors.textPrimary }]}>
                  {Number(seller.trade_rating_avg).toFixed(1)} ★
                </Text>
              ) : null}
            </View>

            <View style={[styles.sellerStats, { borderTopColor: theme.colors.borderLight }]}>
              {[
                { v: String(seller.deal_count), l: t("listing.deals") },
                { v: seller.response_rate_pct !== null ? `${seller.response_rate_pct}%` : "—", l: t("listing.response") },
                {
                  v: seller.response_time_median_sec !== null
                    ? `~${Math.round(seller.response_time_median_sec / 3600)}${t("listing.hours")}`
                    : "—",
                  l: t("listing.responseTime"),
                },
                { v: String(seller.complaint_count), l: t("listing.complaints") },
              ].map((s) => (
                <View key={s.l} style={styles.sellerStat}>
                  <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{s.v}</Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                    {s.l.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Kiksu holds no money and arbitrates no disputes. Saying that on the
            screen where someone decides to meet a stranger is the only honest
            place for it. */}
        <View style={[styles.safety, { backgroundColor: theme.colors.urgentLight, borderColor: theme.colors.urgent }]}>
          <Text style={[styles.safetyText, { color: theme.colors.urgentDark }]}>{t("listing.safety")}</Text>
        </View>

        <Pressable
          disabled
          style={[styles.cta, { borderColor: theme.colors.border, opacity: 0.55 }]}
        >
          <Text style={[styles.ctaText, { color: theme.colors.textMuted }]}>
            {t("listing.messageSeller")} — {t("listing.chatNotBuilt")}
          </Text>
        </Pressable>

        <Pressable onPress={() => setReporting(true)} style={styles.reportBtn}>
          <Text style={[styles.reportText, { color: theme.colors.textPlaceholder }]}>
            {t("listing.report")}
          </Text>
        </Pressable>
      </ScrollView>

      <ReportSheet
        visible={reporting}
        targetType="listing"
        targetId={data.id}
        onClose={() => setReporting(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  gallery: { height: 180, borderWidth: 1, borderStyle: "dashed", borderRadius: 4, alignItems: "center", justifyContent: "center" },
  galleryText: { fontSize: 10, letterSpacing: 1 },
  title: { fontSize: 19, fontWeight: "700", lineHeight: 25, letterSpacing: -0.2 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  price: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { fontSize: 9, letterSpacing: 0.7, borderWidth: 1, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 3 },
  description: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 9, letterSpacing: 1.2 },
  meetup: { fontSize: 13, lineHeight: 19 },
  seller: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 12 },
  sellerHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 12, fontWeight: "700" },
  handle: { fontSize: 14, fontWeight: "600" },
  sellerUni: { fontSize: 9, letterSpacing: 0.8, marginTop: 1 },
  rating: { fontSize: 15, fontWeight: "700" },
  sellerStats: { flexDirection: "row", borderTopWidth: 1, paddingTop: 10 },
  sellerStat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 14, fontWeight: "700" },
  statLabel: { fontSize: 7.5, letterSpacing: 0.6, textAlign: "center" },
  safety: { borderWidth: 1, borderRadius: 4, padding: 11 },
  safetyText: { fontSize: 11, lineHeight: 16 },
  cta: { borderWidth: 1, borderRadius: 4, paddingVertical: 13, alignItems: "center" },
  ctaText: { fontSize: 13, fontWeight: "600" },
  reportBtn: { alignItems: "center", paddingVertical: 8 },
  reportText: { fontSize: 12 },
});
