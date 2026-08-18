import React from "react";
import { ActivityIndicator, Pressable, FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useBoardFeed } from "@/api/queries";
import { PostCard } from "@/features/forum/PostCard";

export default function BoardFeedScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, isPending, error } = useBoardFeed(slug);

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
      <Stack.Screen options={{ title: slug }} />
      <FlatList
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        data={data.items}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.colors.textPlaceholder }]}>
            {t("forum.noPosts")}
          </Text>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => router.push({ pathname: "/forum/post/[id]", params: { id: item.id } })}
          />
        )}
      />
      {/* Pre-selects this board, since a student on a board who taps "write"
          almost always means "write here". Still changeable in the composer. */}
      <Pressable
        onPress={() => router.push({ pathname: "/forum/new", params: { board: slug } })}
        accessibilityRole="button"
        accessibilityLabel={t("forum.newPost")}
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
      >
        <Text style={[styles.fabText, { color: theme.colors.onPrimary }]}>+ {t("forum.write")}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 13, textAlign: "center", marginTop: 40, fontStyle: "italic" },
  fab: {
    position: "absolute", right: 16, bottom: 20,
    paddingHorizontal: 18, paddingVertical: 13, borderRadius: 26,
  },
  fabText: { fontSize: 14, fontWeight: "700" },
});
