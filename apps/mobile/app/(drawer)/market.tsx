import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useListings } from "@/api/queries";

/** Minor units to a display string. 2500 -> "25 ₼". Never floats in transit. */
function formatPrice(minor: number): string {
  const major = minor / 100;
  return `${Number.isInteger(major) ? major : major.toFixed(2)} ₼`;
}

export default function MarketScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data, isPending, error } = useListings();

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
        <Text style={{ color: theme.colors.textMuted }}>{t("market.loadFailed")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={data}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={
        // The design puts this on the listing screen. Kiksu holds no money and
        // arbitrates no disputes, so saying it plainly and early is the only
        // honest thing to do — burying it under a listing would not be.
        <View style={[styles.safety, { backgroundColor: theme.colors.urgentLight, borderColor: theme.colors.urgent }]}>
          <Text style={[styles.safetyText, { color: theme.colors.urgentDark }]}>{t("market.safety")}</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.colors.textPlaceholder }]}>{t("market.noListings")}</Text>
      }
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={styles.topRow}>
            <Text style={[styles.cat, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
              {item.category_name.toUpperCase()}
            </Text>
            {item.related_course_code ? (
              <Text style={[styles.cat, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
                {item.related_course_code}
              </Text>
            ) : null}
          </View>

          <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
            {item.title}
          </Text>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: theme.colors.textPrimary }]}>
              {formatPrice(item.price_minor)}
            </Text>
            {item.is_negotiable ? (
              <Text style={[styles.tag, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                {t("market.negotiable").toUpperCase()}
              </Text>
            ) : null}
          </View>

          {item.seller ? (
            <View style={[styles.seller, { borderTopColor: theme.colors.borderLight }]}>
              <Text style={[styles.handle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {item.seller.handle}
                {item.seller.verification_status === "card" ? " ✓" : ""}
              </Text>
              <Text style={[styles.sellerMeta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                {item.seller.trade_rating_avg !== null
                  ? `★ ${Number(item.seller.trade_rating_avg).toFixed(1)}  `
                  : ""}
                {item.seller.deal_count} {t("market.deals")}
                {item.seller.response_rate_pct !== null
                  ? `  ${item.seller.response_rate_pct}% ${t("market.response")}`
                  : ""}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  safety: { borderWidth: 1, borderRadius: 4, padding: 10, marginBottom: 6 },
  safetyText: { fontSize: 11, lineHeight: 16 },
  empty: { fontSize: 13, textAlign: "center", marginTop: 40, fontStyle: "italic" },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 6 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  cat: { fontSize: 9, letterSpacing: 0.9 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  price: { fontSize: 17, fontWeight: "700" },
  tag: { fontSize: 9, letterSpacing: 0.8 },
  seller: { borderTopWidth: 1, paddingTop: 8, marginTop: 2, gap: 2 },
  handle: { fontSize: 12, fontWeight: "600" },
  sellerMeta: { fontSize: 10 },
});
