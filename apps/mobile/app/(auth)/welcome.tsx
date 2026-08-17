import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";

export default function WelcomeScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { handle } = useLocalSearchParams<{ handle: string }>();

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={{ gap: 10, alignItems: "center" }}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{t("onboarding.welcome")}</Text>

        <Text style={[styles.label, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
          {t("onboarding.yourHandle").toUpperCase()}
        </Text>

        {/* The handle is the whole point of the screen: a student's first sight
            of the identity they will actually carry. It was generated, not
            chosen, so showing it plainly and once is how they learn that. */}
        <Text style={[styles.handle, { color: theme.colors.primary }]}>{handle}</Text>

        <Text style={[styles.note, { color: theme.colors.textMuted }]}>{t("onboarding.handleNote")}</Text>
      </View>

      <Pressable
        onPress={() => router.replace("/today")}
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
      >
        <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>{t("onboarding.enter")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 120, justifyContent: "space-between", paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  label: { fontSize: 10, letterSpacing: 1.4, marginTop: 24 },
  handle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.3 },
  note: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8, maxWidth: 280 },
  button: { borderRadius: 4, paddingVertical: 15, alignItems: "center" },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
