import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import type { PostSummary } from "@/api/types";
import { AliasBadge } from "./AliasBadge";

export function PostCard({ post, onPress }: { post: PostSummary; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <AliasBadge author={post.author} />
        {/* The opt-in campus badge. Absent unless the author deliberately
            ticked it, which is why it is rendered plainly rather than styled
            as an accolade. */}
        {post.author_university_code ? (
          <Text
            style={[styles.uni, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}
          >
            {post.author_university_code}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {post.title}
      </Text>

      {post.excerpt ? (
        <Text style={[styles.excerpt, { color: theme.colors.textMuted }]} numberOfLines={2}>
          {post.excerpt}
        </Text>
      ) : null}

      <View style={styles.stats}>
        <Text style={[styles.stat, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          ▲ {post.score}
        </Text>
        <Text style={[styles.stat, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          ▭ {post.comment_count}
        </Text>
        <Text style={[styles.stat, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          ◇ {post.save_count}
        </Text>
        {post.kind === "poll" ? (
          <Text style={[styles.stat, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
            {t("forum.votes").toUpperCase()}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 6 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  uni: { fontSize: 10, letterSpacing: 0.6 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  excerpt: { fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: "row", gap: 14, marginTop: 2 },
  stat: { fontSize: 11 },
});
