import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useMyProfile } from "@/api/queries";
import { useRotateHandle, useUpdatePrivacy } from "@/api/mutations";
import { PrivacyToggle } from "@/features/profile/PrivacyToggle";
import type { PrivacyKey } from "@/api/types";

export default function ProfileScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data, isPending, error } = useMyProfile();
  const privacy = useUpdatePrivacy();
  const rotate = useRotateHandle();

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
        <Text style={{ color: theme.colors.textMuted }}>{t("profile.loadFailed")}</Text>
      </View>
    );
  }

  const set = (key: PrivacyKey) => (next: boolean) => privacy.mutate({ [key]: next });

  const label = (s: string) => (
    <Text style={[styles.sectionLabel, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
      {s.toUpperCase()}
    </Text>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 26, paddingBottom: 40 }}
    >
      {/* Identity */}
      <View style={{ alignItems: "center", gap: 8 }}>
        <View style={[styles.avatar, { backgroundColor: theme.colors.primaryLight }]}>
          <Text style={[styles.avatarText, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
            {data.avatar_id}
          </Text>
        </View>

        <Text style={[styles.handle, { color: theme.colors.textPrimary }]}>{data.handle}</Text>

        <Text style={[styles.handleMeta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {t("profile.forumHandle").toUpperCase()} · {t("profile.cooldownNote").toUpperCase()}
        </Text>

        <Pressable
          disabled={!data.can_change_handle || rotate.isPending}
          onPress={() => rotate.mutate()}
          style={[
            styles.changeBtn,
            {
              borderColor: data.can_change_handle ? theme.colors.primary : theme.colors.border,
              opacity: data.can_change_handle ? 1 : 0.55,
            },
          ]}
        >
          <Text
            style={[
              styles.changeText,
              { color: data.can_change_handle ? theme.colors.primary : theme.colors.textPlaceholder },
            ]}
          >
            {data.can_change_handle
              ? t("profile.change")
              // Saying WHEN it unlocks is the difference between a disabled
              // button that looks broken and one that explains itself.
              : t("profile.changeAvailable", {
                  date: new Date(data.handle_change_allowed_at).toLocaleDateString("az"),
                })}
          </Text>
        </Pressable>

        <View style={styles.badges}>
          {data.verification_tier !== "unverified" ? (
            <Text style={[styles.badge, { color: theme.colors.primary, backgroundColor: theme.colors.primaryLight, fontFamily: theme.fontFamilies.mono }]}>
              ✓ {t("profile.emailVerified").toUpperCase()}
            </Text>
          ) : null}
          {/* Tier and card state are independent facts, as the design shows. */}
          {data.verification_tier === "card_verified" ? (
            <Text style={[styles.badge, { color: theme.colors.secondaryDark, backgroundColor: theme.colors.secondaryLight, fontFamily: theme.fontFamilies.mono }]}>
              {t("profile.cardVerified").toUpperCase()}
            </Text>
          ) : data.card_review_state === "pending" || data.card_review_state === "in_review" ? (
            <Text style={[styles.badge, { color: theme.colors.secondaryDark, backgroundColor: theme.colors.secondaryLight, fontFamily: theme.fontFamilies.mono }]}>
              {t("profile.cardPending").toUpperCase()}
            </Text>
          ) : null}
        </View>

        {data.university_code ? (
          <Text style={[styles.uni, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
            {data.university_code}
            {data.study_year ? ` · ${t("profile.year", { n: data.study_year }).toUpperCase()}` : ""}
          </Text>
        ) : null}
      </View>

      {/* Stats. Exact karma is shown HERE and on no cross-user surface. */}
      <View style={[styles.stats, { borderColor: theme.colors.border }]}>
        {[
          { v: data.karma, l: t("profile.karma") },
          { v: data.post_count, l: t("profile.posts") },
          { v: data.trade_rating_avg !== null ? Number(data.trade_rating_avg).toFixed(1) : "—", l: t("profile.marketRating") },
        ].map((s, i) => (
          <View key={s.l} style={[styles.stat, i < 2 && { borderRightWidth: 1, borderRightColor: theme.colors.border }]}>
            <Text style={[styles.statValue, { color: theme.colors.textPrimary }]}>{s.v}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
              {s.l.toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      {/* Privacy */}
      <View style={{ gap: 2 }}>
        {label(t("profile.privacy"))}
        <PrivacyToggle
          label={t("profile.showYear")} note={t("profile.showYearNote")}
          value={data.privacy.show_year} onChange={set("show_year")}
        />
        <PrivacyToggle
          label={t("profile.shareTimetable")} note={t("profile.shareTimetableNote")}
          value={data.privacy.share_timetable} onChange={set("share_timetable")}
        />
        <PrivacyToggle
          label={t("profile.uniBadge")} note={t("profile.uniBadgeNote")}
          value={data.privacy.show_uni_badge} onChange={set("show_uni_badge")}
        />
        <PrivacyToggle
          label={t("profile.linkListings")} note={t("profile.linkListingsNote")}
          value={data.privacy.link_listings} onChange={set("link_listings")}
        />
        <PrivacyToggle
          label={t("profile.discoverable")} note={t("profile.discoverableNote")}
          value={data.privacy.discoverable} onChange={set("discoverable")}
        />
      </View>

      {/* Career identity — Layer 4, and the screen says why it is separate. */}
      <View style={{ gap: 8 }}>
        {label(t("profile.careerTitle"))}
        <View style={[styles.career, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.careerState, { color: theme.colors.textPlaceholder }]}>
            {t("profile.careerNone")}
          </Text>
          <Text style={[styles.careerNote, { color: theme.colors.textMuted }]}>
            {t("profile.careerNote")}
          </Text>
          <Text style={[styles.notBuilt, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            {t("profile.notBuilt").toUpperCase()}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatar: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontWeight: "700" },
  handle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  handleMeta: { fontSize: 9, letterSpacing: 1 },
  changeBtn: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 14, paddingVertical: 6, marginTop: 2 },
  changeText: { fontSize: 12, fontWeight: "600" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, justifyContent: "center" },
  badge: { fontSize: 9, letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2 },
  uni: { fontSize: 10, letterSpacing: 1, marginTop: 2 },
  stats: { flexDirection: "row", borderWidth: 1, borderRadius: 4 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 14, gap: 3 },
  statValue: { fontSize: 19, fontWeight: "700" },
  statLabel: { fontSize: 8, letterSpacing: 0.9 },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  career: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 8 },
  careerState: { fontSize: 14, fontWeight: "600" },
  careerNote: { fontSize: 12, lineHeight: 18 },
  notBuilt: { fontSize: 9, letterSpacing: 0.9, marginTop: 2 },
});
