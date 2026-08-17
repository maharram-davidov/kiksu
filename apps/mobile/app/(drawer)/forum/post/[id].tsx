import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { usePost } from "@/api/queries";
import { AliasBadge } from "@/features/forum/AliasBadge";

export default function PostDetailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, error } = usePost(id);

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

  return (
    <>
      <Stack.Screen options={{ title: data.board.name }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, gap: 16 }}
      >
        <View style={{ gap: 8 }}>
          <View style={styles.headRow}>
            <AliasBadge author={data.author} />
            {data.author_university_code ? (
              <Text style={[styles.uni, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                {data.author_university_code}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{data.title}</Text>
          {data.body ? (
            <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{data.body}</Text>
          ) : null}
          <Text style={[styles.stats, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
            ▲ {data.score}   ▭ {data.comment_count}   ◇ {data.save_count}
          </Text>
        </View>

        {data.poll ? (
          <View style={[styles.poll, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.pollQ, { color: theme.colors.textPrimary }]}>{data.poll.question}</Text>
            {data.poll.options.map((o) => {
              const pct = data.poll!.total_votes
                ? Math.round((o.vote_count / data.poll!.total_votes) * 100)
                : 0;
              return (
                <View key={o.position} style={{ gap: 4 }}>
                  <View style={styles.pollRow}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{o.label}</Text>
                    <Text style={{ color: theme.colors.primary, fontSize: 13, fontFamily: theme.fontFamilies.mono }}>
                      {pct}%
                    </Text>
                  </View>
                  {/* Bar width encodes the same number as the label, so the
                      split reads at a glance without parsing digits. */}
                  <View style={[styles.barTrack, { backgroundColor: theme.colors.borderLight }]}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.colors.primary }]} />
                  </View>
                </View>
              );
            })}
            <Text style={[styles.pollTotal, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
              {t("forum.pollTotal", { count: data.poll.total_votes })}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
            {data.comment_count} {t("forum.comments").toUpperCase()}
          </Text>
          {data.comments.map((c) => (
            <View
              key={c.id}
              style={[styles.comment, { borderColor: theme.colors.borderLight, backgroundColor: theme.colors.surface }]}
            >
              <AliasBadge author={c.author} />
              <Text style={[styles.commentBody, { color: theme.colors.textSecondary }]}>{c.body}</Text>
              <Text style={[styles.commentScore, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                ▲ {c.score}
              </Text>
            </View>
          ))}
        </View>

        {/* The composer's promise, from the design: it tells you which alias
            you WILL get before you write. The server reserves it with a TTL
            rather than consuming it, so an abandoned draft leaves no gap. */}
        <View style={[styles.composer, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}>
          <Text style={[styles.composerText, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
            {t("forum.writeAs", { alias: `${t("forum.anonymous")} ${data.your_next_alias}` }).toUpperCase()}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  uni: { fontSize: 10, letterSpacing: 0.6 },
  title: { fontSize: 19, fontWeight: "700", lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 21 },
  stats: { fontSize: 12, marginTop: 2 },
  poll: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 10 },
  pollQ: { fontSize: 14, fontWeight: "600" },
  pollRow: { flexDirection: "row", justifyContent: "space-between" },
  barTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4 },
  pollTotal: { fontSize: 10, letterSpacing: 0.6 },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4 },
  comment: { borderWidth: 1, borderRadius: 4, padding: 10, gap: 6 },
  commentBody: { fontSize: 13, lineHeight: 19 },
  commentScore: { fontSize: 11 },
  composer: { borderWidth: 1, borderRadius: 4, padding: 14, alignItems: "center" },
  composerText: { fontSize: 11, letterSpacing: 1 },
});
