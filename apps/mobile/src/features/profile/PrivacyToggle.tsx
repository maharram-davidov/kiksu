import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * One privacy control.
 *
 * The explanatory line is not optional decoration — it is the difference
 * between a switch a student flips blindly and one they can decide about.
 * "Show my year" means nothing on its own; "year and faculty only, never your
 * name" is the thing that actually answers what gets disclosed.
 */
export function PrivacyToggle({
  label, note, value, onChange, disabled,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.borderLight }]}>
      <View style={{ flex: 1, gap: 2, paddingRight: 12 }}>
        <Text style={[styles.label, { color: theme.colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.note, { color: theme.colors.textMuted }]}>{note}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
        thumbColor={theme.colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  label: { fontSize: 14, fontWeight: "600" },
  note: { fontSize: 11, lineHeight: 16 },
});
