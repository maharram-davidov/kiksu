import React from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useConversation, useMyProfile } from "@/api/queries";
import { useSendMessage } from "@/api/mutations";
import type { ChatMessage } from "@/api/types";

export default function ChatScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending } = useConversation(id);
  const { data: me } = useMyProfile();
  const send = useSendMessage(id);
  const [draft, setDraft] = React.useState("");
  const [offering, setOffering] = React.useState(false);
  const [offer, setOffer] = React.useState("");

  if (isPending || !data) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const other = data.participants.find((p) => p.handle !== me?.handle);
  const mine = (m: ChatMessage) => m.sender_id !== other?.app_user_id;

  const submit = () => {
    if (offering) {
      const minor = Math.round((Number(offer.replace(",", ".")) || 0) * 100);
      send.mutate({ offerPriceMinor: minor }, {
        onSuccess: () => { setOffer(""); setOffering(false); },
      });
      return;
    }
    if (!draft.trim()) return;
    send.mutate({ body: draft.trim() }, { onSuccess: () => setDraft("") });
  };

  return (
    <>
      <Stack.Screen options={{ title: other?.handle ?? t("chat.messages") }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        {data.listing_title ? (
          <View style={[styles.listingBar, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.listingTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {data.listing_title}
            </Text>
            {data.listing_price_minor !== null ? (
              <Text style={[styles.listingPrice, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                {data.listing_price_minor / 100} ₼
              </Text>
            ) : null}
          </View>
        ) : null}

        <FlatList
          data={data.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 8 }}
          ListHeaderComponent={
            // Now that chat exists, sharing a number is no longer necessary —
            // and the banner says so, because the safest path only works if
            // people know it is there.
            <View style={[styles.safety, { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primaryAccent }]}>
              <Text style={[styles.safetyText, { color: theme.colors.primaryHover }]}>{t("chat.safety")}</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.colors.textPlaceholder }]}>{t("chat.noMessages")}</Text>
          }
          renderItem={({ item }) => {
            const isMine = mine(item);
            return (
              <View
                style={[
                  styles.bubble,
                  {
                    alignSelf: isMine ? "flex-end" : "flex-start",
                    backgroundColor: isMine ? theme.colors.primary : theme.colors.surface,
                    borderColor: isMine ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                {item.is_limited ? (
                  // Never render the flagged text, to either party.
                  <Text style={[styles.limited, { color: isMine ? theme.colors.onPrimary : theme.colors.textPlaceholder }]}>
                    {t("chat.limited")}
                  </Text>
                ) : item.kind === "offer" ? (
                  <Text style={[styles.offerText, { color: isMine ? theme.colors.onPrimary : theme.colors.textPrimary }]}>
                    {t("chat.offerMade", { price: (item.offer_price_minor ?? 0) / 100 })}
                  </Text>
                ) : (
                  <Text style={[styles.body, { color: isMine ? theme.colors.onPrimary : theme.colors.textPrimary }]}>
                    {item.body}
                  </Text>
                )}
              </View>
            );
          }}
        />

        <View style={[styles.composer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable
            onPress={() => setOffering((v) => !v)}
            style={[styles.offerBtn, { borderColor: offering ? theme.colors.primary : theme.colors.border }]}
          >
            <Text style={[styles.offerBtnText, { color: offering ? theme.colors.primary : theme.colors.textMuted }]}>
              ₼
            </Text>
          </Pressable>

          <TextInput
            value={offering ? offer : draft}
            onChangeText={offering ? (v) => setOffer(v.replace(/[^0-9.,]/g, "")) : setDraft}
            placeholder={offering ? t("chat.offerPlaceholder") : t("chat.write")}
            placeholderTextColor={theme.colors.textPlaceholder}
            keyboardType={offering ? "decimal-pad" : "default"}
            multiline={!offering}
            style={[
              styles.input,
              { color: theme.colors.textPrimary, borderColor: theme.colors.border, backgroundColor: theme.colors.background },
            ]}
          />

          <Pressable
            disabled={send.isPending || (offering ? !offer.trim() : !draft.trim())}
            onPress={submit}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  send.isPending || (offering ? !offer.trim() : !draft.trim())
                    ? theme.colors.borderLight
                    : theme.colors.primary,
              },
            ]}
          >
            <Text style={[styles.sendText, { color: theme.colors.onPrimary }]}>
              {offering ? t("chat.offer") : t("chat.send")}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  listingBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12, borderBottomWidth: 1 },
  listingTitle: { fontSize: 13, fontWeight: "600", flex: 1 },
  listingPrice: { fontSize: 13, fontWeight: "700" },
  safety: { borderWidth: 1, borderRadius: 4, padding: 10, marginBottom: 6 },
  safetyText: { fontSize: 11, lineHeight: 16 },
  empty: { fontSize: 13, textAlign: "center", marginTop: 30, fontStyle: "italic" },
  bubble: { maxWidth: "78%", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  body: { fontSize: 14, lineHeight: 19 },
  offerText: { fontSize: 15, fontWeight: "700" },
  limited: { fontSize: 12, fontStyle: "italic" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1 },
  offerBtn: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 11, paddingVertical: 9 },
  offerBtnText: { fontSize: 15, fontWeight: "700" },
  input: { flex: 1, borderWidth: 1, borderRadius: 4, paddingHorizontal: 11, paddingVertical: 9, fontSize: 14, maxHeight: 96 },
  sendBtn: { borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
  sendText: { fontSize: 13, fontWeight: "600" },
});
