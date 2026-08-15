import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { typography } from '@kiksu/tokens';
import { useTheme } from '@/theme/ThemeProvider';

interface ScreenPlaceholderProps {
  title: string;
  description: string;
}

/**
 * Stage-1 screen body: title + one-line description, styled from the theme.
 * Every drawer destination renders one of these until its real content
 * lands — see the brief: "Placeholder screen bodies are correct at this
 * stage."
 */
export function ScreenPlaceholder({ title, description }: ScreenPlaceholderProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[theme.text(typography.heading.md), { color: theme.colors.textPrimary }]}>{title}</Text>
        <Text
          style={[
            theme.text(typography.body.base),
            { color: theme.colors.textSecondary, marginTop: theme.spacing['3'] },
          ]}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
});
