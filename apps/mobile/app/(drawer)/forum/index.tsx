import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useBoards } from "@/api/queries";
import type { Board } from "@/api/types";

export default function BoardListScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isPending, error } = useBoards();

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
        <Text style={{ color: theme.colors.textMuted }}>{t("forum.loadFailed")}</Text>
      </View>
    );
  }

  // Campus boards first, then the national tier. The design's own ordering:
  // a student's own university is where they spend their time, and the
  // national boards are the long tail that one Azerbaijani campus is too small
  // to sustain on its own.
  const campus = data.filter((b) => b.university_code !== null);
  const national = data.filter((b) => b.university_code === null);

  const section = (title: string, boards: Board[]) =>
    boards.length === 0 ? null : (
      <View key={title} style={{ gap: 8 }}>
        <Text
          style={[styles.sectionLabel, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}
        >
          {title}
        </Text>
        {boards.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => router.push({ pathname: "/forum/board/[slug]", params: { slug: b.slug } })}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{b.name}</Text>
              {b.description ? (
                <Text style={[styles.desc, { color: theme.colors.textMuted }]} numberOfLines={1}>
                  {b.description}
                </Text>
              ) : null}
            </View>
            <Text
              style={[styles.count, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}
            >
              {b.follower_count.toLocaleString("az")}
            </Text>
          </Pressable>
        ))}
      </View>
    );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, gap: 22 }}
    >
      {section(t("forum.campus").toUpperCase(), campus)}
      {section(t("forum.national").toUpperCase(), national)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  name: { fontSize: 15, fontWeight: "600" },
  desc: { fontSize: 12 },
  count: { fontSize: 11 },
});
