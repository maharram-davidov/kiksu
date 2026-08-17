import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useMarketCategories } from "@/api/queries";
import { useCreateListing } from "@/api/mutations";
import type { ListingCondition } from "@/api/types";

const CONDITIONS: ListingCondition[] = ["new", "like_new", "good", "fair", "poor"];

/**
 * Compose a listing.
 *
 * Price is entered in manat and converted to qəpik here — the only place in
 * the app that conversion happens. Everything downstream, including the wire
 * format, is integer minor units, because a float anywhere in a price is a
 * rounding bug waiting for something that costs 33.33.
 */
export default function NewListingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { data: categories } = useMarketCategories();
  const create = useCreateListing();

  const [categoryKey, setCategoryKey] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [negotiable, setNegotiable] = React.useState(true);
  const [condition, setCondition] = React.useState<ListingCondition>("good");
  const [meetup, setMeetup] = React.useState("");

  const priceMinor = Math.round((Number(price.replace(",", ".")) || 0) * 100);
  const valid = categoryKey !== null && title.trim().length >= 3 && price.trim() !== "";

  const submit = () => {
    if (!categoryKey) return;
    create.mutate(
      {
        categoryKey,
        title: title.trim(),
        description: description.trim() || undefined,
        priceMinor,
        isNegotiable: negotiable,
        condition,
        meetupNotes: meetup.trim() ? [meetup.trim()] : [],
      },
      { onSuccess: (l) => router.replace({ pathname: "/market/listing/[id]", params: { id: l.id } }) },
    );
  };

  const label = (s: string) => (
    <Text style={[styles.label, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
      {s.toUpperCase()}
    </Text>
  );

  const input = {
    color: theme.colors.textPrimary,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  };

  return (
    <>
      <Stack.Screen options={{ title: t("sell.newListing") }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={{ backgroundColor: theme.colors.background }}
          contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 6 }}>
            {label(t("sell.category"))}
            <View style={styles.chips}>
              {(categories ?? []).map((c) => {
                const on = c.key === categoryKey;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setCategoryKey(c.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                        borderColor: on ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: on ? theme.colors.onPrimary : theme.colors.textSecondary }]}>
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            {label(t("sell.titleField"))}
            <TextInput
              value={title} onChangeText={setTitle}
              placeholder={t("sell.titlePlaceholder")}
              placeholderTextColor={theme.colors.textPlaceholder}
              style={[styles.input, input]}
            />
          </View>

          <View style={{ gap: 6 }}>
            {label(t("sell.descField"))}
            <TextInput
              value={description} onChangeText={setDescription}
              placeholder={t("sell.descPlaceholder")}
              placeholderTextColor={theme.colors.textPlaceholder}
              multiline
              style={[styles.input, styles.multiline, input]}
            />
          </View>

          <View style={{ gap: 6 }}>
            {label(t("sell.priceField"))}
            <View style={styles.priceRow}>
              <TextInput
                value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.,]/g, ""))}
                placeholder="0"
                placeholderTextColor={theme.colors.textPlaceholder}
                keyboardType="decimal-pad"
                style={[styles.input, input, { flex: 1 }]}
              />
              <Text style={[styles.currency, { color: theme.colors.textPrimary }]}>₼</Text>
            </View>
            <Text style={[styles.hint, { color: theme.colors.textPlaceholder }]}>{t("sell.freeHint")}</Text>
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: theme.colors.textPrimary }]}>
                {t("sell.negotiable")}
              </Text>
              <Switch
                value={negotiable} onValueChange={setNegotiable}
                trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
                thumbColor={theme.colors.surface}
              />
            </View>
          </View>

          <View style={{ gap: 6 }}>
            {label(t("sell.conditionField"))}
            <View style={styles.chips}>
              {CONDITIONS.map((c) => {
                const on = c === condition;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCondition(c)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                        borderColor: on ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: on ? theme.colors.onPrimary : theme.colors.textSecondary }]}>
                      {t(`listing.condition${c === "like_new" ? "LikeNew" : c[0]!.toUpperCase() + c.slice(1)}` as never)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            {label(t("sell.meetupField"))}
            <TextInput
              value={meetup} onChangeText={setMeetup}
              placeholder={t("sell.meetupPlaceholder")}
              placeholderTextColor={theme.colors.textPlaceholder}
              style={[styles.input, input]}
            />
          </View>

          {/* Told BEFORE they type it, not flagged after they post it. The
              server tolerates a phone number today only because in-app chat
              does not exist yet; this is the nudge toward the safer path. */}
          <View style={[styles.warning, { backgroundColor: theme.colors.urgentLight, borderColor: theme.colors.urgent }]}>
            <Text style={[styles.warningText, { color: theme.colors.urgentDark }]}>
              {t("sell.contactWarning")}
            </Text>
          </View>

          {create.isError ? (
            <Text style={[styles.err, { color: theme.colors.urgent }]}>{t("sell.failed")}</Text>
          ) : null}

          <Pressable
            disabled={!valid || create.isPending}
            onPress={submit}
            style={[
              styles.publish,
              { backgroundColor: !valid || create.isPending ? theme.colors.borderLight : theme.colors.primary },
            ]}
          >
            {create.isPending ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : (
              <Text style={[styles.publishText, { color: theme.colors.onPrimary }]}>{t("sell.publish")}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 9, letterSpacing: 1.2 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  currency: { fontSize: 20, fontWeight: "700" },
  hint: { fontSize: 11 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  warning: { borderWidth: 1, borderRadius: 4, padding: 11 },
  warningText: { fontSize: 11, lineHeight: 16 },
  err: { fontSize: 12 },
  publish: { borderRadius: 4, paddingVertical: 14, alignItems: "center" },
  publishText: { fontSize: 15, fontWeight: "600" },
});
