import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { startEmailVerification } from "@/api/queries";
import { ApiError } from "@/api/client";

export default function EmailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { sample } = useLocalSearchParams<{ sample: string }>();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await startEmailVerification(email.trim());
      router.push({ pathname: "/(auth)/code", params: { email: email.trim() } });
    } catch (e) {
      // An unrecognised domain is the one failure worth naming precisely: the
      // student can act on it (their university isn't on Kiksu yet), and a
      // domain is not personal information. Everything else stays generic.
      const api = e instanceof ApiError ? e : null;
      setErr(api?.code === "email_domain_not_recognised" ? t("onboarding.badDomain") : t("forum.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          {t("onboarding.emailTitle")}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t("onboarding.emailHint")}</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          // The real sample comes from ref.university_email_domain, per
          // university. The fallback is deliberately generic: it used to be
          // BDU's address, which meant a student at any other university saw
          // an address that does not exist for them whenever sample_pattern
          // was missing.
          placeholder={sample || "ad.soyad@std.universitet.edu.az"}
          placeholderTextColor={theme.colors.textPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
          ]}
        />

        {err ? <Text style={[styles.err, { color: theme.colors.urgent }]}>{err}</Text> : null}

        <Pressable
          disabled={!email.includes("@") || busy}
          onPress={submit}
          style={[
            styles.button,
            { backgroundColor: !email.includes("@") || busy ? theme.colors.borderLight : theme.colors.primary },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>
              {t("onboarding.sendCode")}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  hint: { fontSize: 13, lineHeight: 19 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, marginTop: 4 },
  err: { fontSize: 12, lineHeight: 17 },
  button: { borderRadius: 4, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
