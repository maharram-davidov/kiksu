import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useBoards } from "@/api/queries";
import { useCreatePost } from "@/api/mutations";
import { ApiError } from "@/api/client";

/**
 * Start a thread.
 *
 * **The alias is not previewed here, and that is deliberate.** The thread
 * screen's composer shows "ANONİM 5 KİMİ YAZ" because it asks the server to
 * reserve the next ordinal in an existing thread. A thread that does not exist
 * yet has no alias table, and its author is always ordinal 1 by construction —
 * so this screen states that rather than making a round trip to be told what it
 * already knows.
 *
 * **The campus badge is per post, and only on national boards.** The server
 * rejects it elsewhere. It is rendered as an explicit switch that resets every
 * time, because the design treats it as a disclosure rather than a setting: on
 * a national board it narrows an anonymous author from "a student" to "a
 * student at BDU", and that should be a decision each time, not something a
 * student turned on once in their first week.
 */
export default function NewThreadScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ board?: string }>();

  const { data: boards, isPending } = useBoards();
  const create = useCreatePost();

  const [boardSlug, setBoardSlug] = React.useState<string | null>(params.board ?? null);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [showBadge, setShowBadge] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const board = boards?.find((b) => b.slug === boardSlug) ?? null;
  const isNational = board?.university_code === null;

  // Switching to a campus board must clear the badge rather than carry a value
  // the server would reject.
  React.useEffect(() => {
    if (!isNational && showBadge) setShowBadge(false);
  }, [isNational, showBadge]);

  const valid = boardSlug !== null && title.trim().length >= 3;

  const submit = () => {
    if (!boardSlug || !valid) return;
    setFailure(null);
    create.mutate(
      {
        boardSlug,
        title: title.trim(),
        body: body.trim() === "" ? undefined : body.trim(),
        showUniversityBadge: isNational ? showBadge : false,
      },
      {
        onSuccess: (post) => {
          // Replace rather than push: backing out of a thread you just posted
          // should land on the board, not on an empty composer.
          router.replace({ pathname: "/forum/post/[id]", params: { id: post.id } });
        },
        onError: (e) => {
          const code = e instanceof ApiError ? e.code : null;
          setFailure(
            code === "verification_required" ? t("forum.newNeedsVerification")
            : code === "rate_limited" ? t("forum.newRateLimited")
            : code === "account_suspended" ? t("forum.newSuspended")
            : t("forum.newFailed"),
          );
        },
      },
    );
  };

  const label = (text: string) => (
    <Text style={[styles.label, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
      {text}
    </Text>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: t("forum.newTitle") }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {label(t("forum.newBoard"))}
        {isPending ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <View style={styles.chipWrap}>
            {(boards ?? []).map((b) => {
              const on = b.slug === boardSlug;
              return (
                <Pressable
                  key={b.slug}
                  onPress={() => setBoardSlug(b.slug)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                      borderColor: on ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: on ? theme.colors.onPrimary : theme.colors.textSecondary },
                    ]}
                  >
                    {b.name}
                    {b.university_code === null ? ` · ${t("search.national")}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {label(t("forum.newSubject"))}
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t("forum.newSubjectHint")}
          placeholderTextColor={theme.colors.textPlaceholder}
          maxLength={140}
          style={[styles.input, {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          }]}
        />

        {label(t("forum.newBody"))}
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t("forum.newBodyHint")}
          placeholderTextColor={theme.colors.textPlaceholder}
          multiline
          maxLength={4000}
          style={[styles.input, styles.bodyInput, {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          }]}
        />

        {isNational ? (
          <View style={[styles.badgeRow, { borderColor: theme.colors.borderLight }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: "600" }}>
                {t("forum.newShowBadge")}
              </Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 }}>
                {t("forum.newShowBadgeHint")}
              </Text>
            </View>
            <Switch
              value={showBadge}
              onValueChange={setShowBadge}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
            />
          </View>
        ) : null}

        {/* Stated up front rather than discovered afterwards. */}
        <Text style={[styles.note, { color: theme.colors.textMuted }]}>
          {t("forum.newAliasNote")}
        </Text>

        {failure ? (
          <Text style={[styles.failure, { color: theme.colors.urgent }]}>{failure}</Text>
        ) : null}

        <Pressable
          disabled={!valid || create.isPending}
          onPress={submit}
          style={[styles.submit, {
            backgroundColor: valid && !create.isPending ? theme.colors.primary : theme.colors.border,
          }]}
        >
          <Text style={{ color: theme.colors.onPrimary, fontWeight: "700" }}>
            {create.isPending ? t("forum.newPosting") : t("forum.newPost")}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", marginTop: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  bodyInput: { minHeight: 140, textAlignVertical: "top" },
  badgeRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8,
    padding: 12, marginTop: 12,
  },
  note: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  failure: { fontSize: 13, marginTop: 8 },
  submit: { marginTop: 20, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
});
