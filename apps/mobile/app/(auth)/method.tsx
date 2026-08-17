import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";

export default function MethodScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { code, sample, universityId } =
    useLocalSearchParams<{ code: string; sample: string; universityId: string }>();

  // Two routes only, by product decision — invite codes were dropped. Both are
  // live. The SLA on each is shown because they differ by a factor of 700: a
  // student choosing the card route should know it means waiting a day, not
  // discover that after submitting.
  const methods = [
    {
      key: "email",
      title: t("onboarding.emailMethod"),
      detail: sample || t("onboarding.emailHint"),
      sla: t("onboarding.minutes", { count: 2 }),
      recommended: true,
      enabled: true,
    },
    {
      key: "card",
      title: t("onboarding.cardMethod"),
      detail: t("onboarding.cardHint"),
      sla: t("onboarding.upToHours", { count: 24 }),
      recommended: false,
      enabled: true,
    },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.eyebrow, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
        {code}
      </Text>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{t("onboarding.method")}</Text>

      <View style={{ gap: 10, marginTop: 8 }}>
        {methods.map((m) => (
          <Pressable
            key={m.key}
            disabled={!m.enabled}
            onPress={() =>
              router.push(
                m.key === "email"
                  ? { pathname: "/(auth)/email", params: { code, sample } }
                  : { pathname: "/(auth)/card", params: { code, universityId } },
              )
            }
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
                borderColor: m.recommended ? theme.colors.primary : theme.colors.border,
                opacity: m.enabled ? 1 : 0.5,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.headRow}>
                <Text style={[styles.methodTitle, { color: theme.colors.textPrimary }]}>{m.title}</Text>
                {m.recommended ? (
                  <Text
                    style={[
                      styles.rec,
                      {
                        color: theme.colors.onPrimary,
                        backgroundColor: theme.colors.primary,
                        fontFamily: theme.fontFamilies.mono,
                      },
                    ]}
                  >
                    {t("onboarding.recommended")}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.detail, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                {m.detail}
                {m.sla ? ` — ${m.sla}` : ""}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* The design puts this reassurance on the first screen, and it is the
          single most important sentence in onboarding: it is what makes a
          student willing to hand over a university address at all. */}
      <Text style={[styles.note, { color: theme.colors.textMuted }]}>{t("onboarding.anonymityNote")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 64, gap: 6 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  card: { flexDirection: "row", borderWidth: 1, borderRadius: 4, padding: 14 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  methodTitle: { fontSize: 15, fontWeight: "600" },
  rec: { fontSize: 8, letterSpacing: 0.8, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 2 },
  detail: { fontSize: 11 },
  note: { fontSize: 12, lineHeight: 18, marginTop: "auto", paddingBottom: 16 },
});
