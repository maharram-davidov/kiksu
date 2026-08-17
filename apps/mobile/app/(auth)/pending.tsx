import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useVerificationStatus } from "@/api/queries";
import { useSession } from "@/session/session";

/**
 * Waiting for a human.
 *
 * Polls rather than assuming: a card decision arrives out of band, so the
 * screen has to ask. The SLA is shown because the design promised one, and a
 * wait with no stated bound is how a signup gets abandoned.
 */
export default function PendingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useSession();
  const authUserId = session.status === "loading" ? "" : session.authUserId;
  const { data } = useVerificationStatus(authUserId);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
        {t("onboarding.pendingTitle")}
      </Text>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>{t("onboarding.pendingBody")}</Text>

      {data?.sla_due_at ? (
        <Text style={[styles.sla, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {new Date(data.sla_due_at).toLocaleString("az")}
        </Text>
      ) : null}

      <Text style={[styles.state, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
        {(data?.state ?? "…").toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 140, gap: 12, alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  body: { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 300 },
  sla: { fontSize: 11, marginTop: 8 },
  state: { fontSize: 11, letterSpacing: 1.4, marginTop: 4 },
});
