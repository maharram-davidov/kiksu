import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { usePost } from "@/api/queries";
import { AliasBadge } from "@/features/forum/AliasBadge";
import { useCreateComment, useSavePost, useVotePost } from "@/api/mutations";

export default function PostDetailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, error } = usePost(id);
  const vote = useVotePost(id);
  const save = useSavePost(id);
  const comment = useCreateComment(id);
  const [draft, setDraft] = React.useState("");
  const [myVote, setMyVote] = React.useState<-1 | 0 | 1>(0);
  const [isSaved, setIsSaved] = React.useState(false);

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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
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
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                // Tapping the active arrow clears the vote rather than
                // re-casting it; there is no way to "unvote" otherwise.
                const next: -1 | 0 | 1 = myVote === 1 ? 0 : 1;
                setMyVote(next);
                vote.mutate(next);
              }}
              style={[styles.action, { borderColor: theme.colors.border }]}
            >
              <Text
                style={[
                  styles.actionText,
                  {
                    color: myVote === 1 ? theme.colors.primary : theme.colors.textPlaceholder,
                    fontFamily: theme.fontFamilies.mono,
                  },
                ]}
              >
                ▲ {data.score}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                const next: -1 | 0 | 1 = myVote === -1 ? 0 : -1;
                setMyVote(next);
                vote.mutate(next);
              }}
              style={[styles.action, { borderColor: theme.colors.border }]}
            >
              <Text
                style={[
                  styles.actionText,
                  {
                    color: myVote === -1 ? theme.colors.urgent : theme.colors.textPlaceholder,
                    fontFamily: theme.fontFamilies.mono,
                  },
                ]}
              >
                ▼
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                const next = !isSaved;
                setIsSaved(next);
                save.mutate(next);
              }}
              style={[styles.action, { borderColor: theme.colors.border }]}
            >
              <Text
                style={[
                  styles.actionText,
                  {
                    color: isSaved ? theme.colors.secondaryDark : theme.colors.textPlaceholder,
                    fontFamily: theme.fontFamilies.mono,
                  },
                ]}
              >
                ◇ {data.save_count}
              </Text>
            </Pressable>

            <Text style={[styles.actionText, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
              ▭ {data.comment_count}
            </Text>
          </View>
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

        {/* The design's promise: it tells you which alias you WILL get before
            you write. The server reserves it with a TTL rather than consuming
            it, so abandoning this draft leaves no gap in the thread. */}
        <View style={[styles.composer, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}>
          <Text style={[styles.composerText, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
            {t("forum.writeAs", { alias: `${t("forum.anonymous")} ${data.your_next_alias}` }).toUpperCase()}
          </Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("forum.writeComment")}
            placeholderTextColor={theme.colors.textPlaceholder}
            multiline
            style={[
              styles.input,
              { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
            ]}
          />
          <Pressable
            disabled={draft.trim().length === 0 || comment.isPending}
            onPress={() => comment.mutate(draft.trim(), { onSuccess: () => setDraft("") })}
            style={[
              styles.send,
              {
                backgroundColor:
                  draft.trim().length === 0 || comment.isPending
                    ? theme.colors.borderLight
                    : theme.colors.primary,
              },
            ]}
          >
            <Text style={[styles.sendText, { color: theme.colors.onPrimary }]}>
              {comment.isPending ? t("forum.sending") : t("forum.send")}
            </Text>
          </Pressable>
          {comment.isError ? (
            <Text style={[styles.sendErr, { color: theme.colors.urgent }]}>{t("forum.sendFailed")}</Text>
          ) : null}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
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
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  action: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5 },
  actionText: { fontSize: 12 },
  composer: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 10 },
  composerText: { fontSize: 11, letterSpacing: 1 },
  input: { borderWidth: 1, borderRadius: 3, padding: 10, minHeight: 72, fontSize: 14, textAlignVertical: "top" },
  send: { borderRadius: 3, paddingVertical: 10, alignItems: "center" },
  sendText: { fontSize: 13, fontWeight: "600" },
  sendErr: { fontSize: 11, textAlign: "center" },
});
