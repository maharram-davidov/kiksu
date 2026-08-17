import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import type { AliasAuthor } from "@/api/types";

/**
 * Renders an anonymous author: "A4 · ANONİM 4 · KART".
 *
 * The verification tier is shown because it is what makes an anonymous claim
 * weigh anything — the design distinguishes ✓ (email) from KART (card), and a
 * card-verified poster is harder to dismiss. It is deliberately the ONLY thing
 * shown beside the ordinal: the wire carries nothing else, and this component
 * exists partly so that stays true as screens get added.
 */
export function AliasBadge({ author }: { author: AliasAuthor }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const tierColor =
    author.tier === "card" ? theme.colors.secondaryDark : theme.colors.primary;

  return (
    <View style={styles.row}>
      <View style={[styles.chip, { backgroundColor: theme.colors.primaryLight }]}>
        <Text style={[styles.chipText, { color: theme.colors.primary, fontFamily: theme.fontFamilies.mono }]}>
          A{author.alias_number}
        </Text>
      </View>

      <Text style={[styles.name, { color: theme.colors.textSecondary }]}>
        {t("forum.anonymous")} {author.alias_number}
      </Text>

      {author.tier !== "unverified" ? (
        <Text style={[styles.tier, { color: tierColor, fontFamily: theme.fontFamilies.mono }]}>
          {author.tier === "card" ? "KART" : "✓"}
        </Text>
      ) : null}

      {author.is_op ? (
        <Text
          style={[
            styles.op,
            {
              color: theme.colors.secondaryDark,
              backgroundColor: theme.colors.secondaryLight,
              fontFamily: theme.fontFamilies.mono,
            },
          ]}
        >
          {t("forum.author")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  chip: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 2 },
  chipText: { fontSize: 10, fontWeight: "700" },
  name: { fontSize: 11, fontWeight: "600" },
  tier: { fontSize: 10 },
  op: { fontSize: 9, letterSpacing: 0.8, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
});
