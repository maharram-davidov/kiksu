import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useUniversities } from "@/api/queries";

export default function UniversityPickerScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isPending } = useUniversities();
  const [q, setQ] = React.useState("");

  // Fold the query the same way the server folds Azerbaijani text, so typing
  // "azerbaycan" finds "Azərbaycan". Doing this only on one side is the usual
  // way this search silently returns nothing.
  const fold = (s: string) =>
    s.toLowerCase().replace(/ə/g, "e").replace(/ğ/g, "g").replace(/ı/g, "i")
      .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/ç/g, "c");

  const filtered = (data ?? []).filter(
    (u) => fold(u.name).includes(fold(q)) || fold(u.code).includes(fold(q)),
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
        {t("onboarding.pickUniversity")}
      </Text>

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder={t("onboarding.search")}
        placeholderTextColor={theme.colors.textPlaceholder}
        autoCorrect={false}
        style={[
          styles.search,
          { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      />

      {isPending ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(auth)/method",
                  params: { universityId: item.id, code: item.code, sample: item.email_sample ?? "" },
                })
              }
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={[styles.code, { backgroundColor: theme.colors.primaryLight }]}>
                <Text style={[styles.codeText, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
                  {item.code}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{item.name}</Text>
                <Text style={[styles.city, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                  {item.city.toUpperCase()}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 64, gap: 14 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  search: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  code: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 3, minWidth: 52, alignItems: "center" },
  codeText: { fontSize: 12, fontWeight: "700" },
  name: { fontSize: 15, fontWeight: "600" },
  city: { fontSize: 9, letterSpacing: 0.9, marginTop: 2 },
});
