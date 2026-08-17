import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { submitCardVerification } from "@/api/queries";
import { useSession } from "@/session/session";

/**
 * Student card submission.
 *
 * The photo itself never passes through the API: the client uploads to a
 * private bucket and submits the path plus a content hash. That upload is NOT
 * wired yet — expo-image-picker and a signed-upload endpoint are the missing
 * pieces — so this screen submits a placeholder reference and says so plainly
 * rather than pretending to have sent an image.
 */
export default function CardScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { code, universityId } = useLocalSearchParams<{ code: string; universityId: string }>();
  const { session } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    if (session.status === "loading") return;
    setBusy(true);
    setErr(null);
    try {
      await submitCardVerification({
        universityId,
        authUserId: session.authUserId,
        // Placeholder until the upload path exists. The hash is required by the
        // API precisely so a swapped file is detectable, so it is sent as a
        // real (if meaningless) 64-hex value rather than being made optional.
        evidencePath: `cards/pending/${session.authUserId}.jpg`,
        evidenceSha256: "0".repeat(64),
      });
      router.replace("/(auth)/pending");
    } catch {
      setErr(t("forum.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.eyebrow, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
        {code}
      </Text>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{t("onboarding.cardTitle")}</Text>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>{t("onboarding.cardBody")}</Text>

      <View style={[styles.frame, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}>
        <Text style={[styles.frameText, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {t("onboarding.cardNotImplemented")}
        </Text>
      </View>

      {/* Retention, stated before submission rather than in a policy page. An
          identity document is the most sensitive thing Kiksu ever holds, and a
          student deserves to know it is deleted before they hand it over. */}
      <Text style={[styles.retention, { color: theme.colors.textMuted }]}>
        {t("onboarding.cardRetention")}
      </Text>

      {err ? <Text style={[styles.err, { color: theme.colors.urgent }]}>{err}</Text> : null}

      <Pressable
        disabled={busy}
        onPress={submit}
        style={[styles.button, { backgroundColor: busy ? theme.colors.borderLight : theme.colors.primary }]}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.onPrimary} />
        ) : (
          <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>
            {t("onboarding.cardSubmit")}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 64, gap: 10 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  body: { fontSize: 13, lineHeight: 19 },
  frame: {
    borderWidth: 1, borderStyle: "dashed", borderRadius: 4,
    height: 168, alignItems: "center", justifyContent: "center", marginTop: 6, padding: 16,
  },
  frameText: { fontSize: 10, letterSpacing: 0.8, textAlign: "center", lineHeight: 16 },
  retention: { fontSize: 12, lineHeight: 18 },
  err: { fontSize: 12 },
  button: { borderRadius: 4, paddingVertical: 14, alignItems: "center", marginTop: "auto", marginBottom: 24 },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
