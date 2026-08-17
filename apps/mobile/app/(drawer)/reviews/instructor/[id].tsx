import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Placeholder so the class sheet's "Müəllim rəyləri ›" leads somewhere real
 * rather than a dead tap. The reviews API is built; this screen is not, and
 * saying so beats a link that silently does nothing.
 */
export default function InstructorReviewsScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[styles.note, { color: theme.colors.textMuted }]}>
          {id}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  note: { fontSize: 11 },
});
