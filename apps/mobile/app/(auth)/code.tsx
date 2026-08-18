import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { confirmEmailVerification, startEmailVerification } from "@/api/queries";
import { useSession } from "@/session/session";

export default function CodeScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { session, completeVerification } = useSession();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    if (session.status === "loading") return;
    setBusy(true);
    setErr(null);
    try {
      const result = await confirmEmailVerification(email, code, session.authUserId);
      // The app_user id the response also carries is deliberately dropped: no
      // screen reads it, and the server already knows it from the token.
      completeVerification({ handle: result.handle, tier: result.tier });
      router.replace({ pathname: "/(auth)/welcome", params: { handle: result.handle } });
    } catch {
      // The API deliberately does not distinguish a wrong code from an expired
      // one or from no attempt at all, because doing so would hand an attacker
      // a search signal. The copy here matches that: one message, both causes.
      setErr(t("onboarding.badCode"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{t("onboarding.codeTitle")}</Text>
        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
          {t("onboarding.codeHint", { email })}
        </Text>

        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          placeholderTextColor={theme.colors.textPlaceholder}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          style={[
            styles.input,
            {
              color: theme.colors.textPrimary,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              fontFamily: theme.fontFamilies.mono,
            },
          ]}
        />

        {err ? <Text style={[styles.err, { color: theme.colors.urgent }]}>{err}</Text> : null}

        <Pressable
          disabled={code.length !== 6 || busy}
          onPress={submit}
          style={[
            styles.button,
            { backgroundColor: code.length !== 6 || busy ? theme.colors.borderLight : theme.colors.primary },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>{t("onboarding.verify")}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => startEmailVerification(email)} style={styles.resend}>
          <Text style={[styles.resendText, { color: theme.colors.primary }]}>{t("onboarding.resend")}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  hint: { fontSize: 13, lineHeight: 19 },
  input: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 14,
    fontSize: 26, letterSpacing: 10, textAlign: "center", marginTop: 4,
  },
  err: { fontSize: 12, lineHeight: 17 },
  button: { borderRadius: 4, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  resend: { alignItems: "center", paddingVertical: 12 },
  resendText: { fontSize: 13, fontWeight: "600" },
});
