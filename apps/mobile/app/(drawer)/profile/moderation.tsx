import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useMyModeration } from "@/api/queries";
import { useFileAppeal } from "@/api/mutations";
import type { MyModerationAction } from "@/api/types";

/** The API caps the body at 1000 and requires 10; enforcing both here avoids a round trip. */
const MIN_BODY = 10;
const MAX_BODY = 1000;

/**
 * "Məzmunum" — what has been done to my content, and how to argue with it.
 *
 * This screen is the answer to a gap that was in the product's own notes:
 * content could be auto-limited with no way to contest it. A student whose
 * post was hidden by a classifier had no surface telling them it had happened,
 * let alone a route to disagree.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW: who decided, who reported, or anything
 * about any other case. That is the mirror image of the rule keeping authors
 * hidden from moderators. Both sides of this product's moderation are
 * anonymous to each other, and for the same reason — staff and students come
 * from the same handful of campuses.
 */
export default function MyModerationScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data, isPending, isError } = useMyModeration();

  if (isPending) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textMuted }}>{t("moderation.loadFailed")}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("moderation.title") }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ backgroundColor: theme.colors.background }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {data && data.length > 0 ? (
            data.map((item) => <ActionCard key={item.action_id} item={item} />)
          ) : (
            // The good case, and worth saying warmly rather than as an empty
            // state: nothing of yours has been actioned.
            <Text style={[styles.empty, { color: theme.colors.textMuted }]}>
              {t("moderation.nothing")}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function ActionCard({ item }: { item: MyModerationAction }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const appeal = useFileAppeal();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    setError(null);
    appeal.mutate(
      { action_id: item.action_id, body: body.trim() },
      {
        onSuccess: () => { setOpen(false); setBody(""); },
        onError: () => setError(t("moderation.appealFailed")),
      },
    );
  };

  return (
    <View style={[styles.card, { borderColor: theme.colors.borderLight, backgroundColor: theme.colors.surface }]}>
      <View style={styles.row}>
        <Text
          style={[
            styles.badge,
            {
              color: theme.colors.urgent,
              backgroundColor: theme.colors.urgentLight,
              fontFamily: theme.fontFamilies.mono,
            },
          ]}
        >
          {t(`moderation.kind.${item.kind}`, { defaultValue: item.kind }).toUpperCase()}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
          {new Date(item.created_at).toLocaleDateString("az-AZ")}
        </Text>
      </View>

      {item.excerpt ? (
        <Text style={[styles.excerpt, { color: theme.colors.textPrimary }]} numberOfLines={3}>
          {item.excerpt}
        </Text>
      ) : null}

      <Text style={[styles.explain, { color: theme.colors.textSecondary }]}>
        {t(`moderation.explain.${item.kind}`, { defaultValue: t("moderation.explain.default") })}
      </Text>

      {/* ---- the appeal, in whichever state it is ---- */}
      {item.appeal_state ? (
        <View style={[styles.outcome, { borderColor: theme.colors.borderLight }]}>
          <Text style={[styles.outcomeState, { color: theme.colors.textPrimary }]}>
            {t(`moderation.appealState.${item.appeal_state}`, { defaultValue: item.appeal_state })}
          </Text>
          {item.appeal_decision_note ? (
            <Text style={[styles.outcomeNote, { color: theme.colors.textSecondary }]}>
              {item.appeal_decision_note}
            </Text>
          ) : null}
        </View>
      ) : item.can_appeal ? (
        open ? (
          <View style={styles.composer}>
            <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
              {t("moderation.appealHint")}
            </Text>
            <TextInput
              value={body}
              onChangeText={(v) => setBody(v.slice(0, MAX_BODY))}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: theme.colors.textPrimary,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.background,
                },
              ]}
            />
            {error ? <Text style={[styles.err, { color: theme.colors.urgent }]}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                disabled={body.trim().length < MIN_BODY || appeal.isPending}
                onPress={submit}
                style={[
                  styles.button,
                  {
                    backgroundColor:
                      body.trim().length < MIN_BODY || appeal.isPending
                        ? theme.colors.borderLight
                        : theme.colors.primary,
                  },
                ]}
              >
                {appeal.isPending ? (
                  <ActivityIndicator color={theme.colors.onPrimary} />
                ) : (
                  <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>
                    {t("moderation.appealSubmit")}
                  </Text>
                )}
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
                <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
                  {t("moderation.cancel")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setOpen(true)} style={styles.appealLink}>
            <Text style={[styles.appealLinkText, { color: theme.colors.primary }]}>
              {t("moderation.appeal")}
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  empty: { fontSize: 14, lineHeight: 21, paddingVertical: 32, textAlign: "center" },

  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { fontSize: 9.5, letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 3 },
  meta: { fontSize: 10 },
  excerpt: { fontSize: 14, lineHeight: 20 },
  explain: { fontSize: 12, lineHeight: 18 },

  appealLink: { paddingVertical: 6 },
  appealLinkText: { fontSize: 14, fontWeight: "600" },

  composer: { gap: 8, marginTop: 4 },
  hint: { fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 6, padding: 10, minHeight: 90, fontSize: 14, lineHeight: 20 },
  err: { fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  button: { flex: 1, borderRadius: 6, paddingVertical: 12, alignItems: "center" },
  buttonText: { fontSize: 14, fontWeight: "600" },
  cancel: { paddingVertical: 12, paddingHorizontal: 4 },

  outcome: { borderWidth: 1, borderRadius: 6, padding: 10, gap: 4, marginTop: 4 },
  outcomeState: { fontSize: 13, fontWeight: "600" },
  outcomeNote: { fontSize: 13, lineHeight: 19 },
});
