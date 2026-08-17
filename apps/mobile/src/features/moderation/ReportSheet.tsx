import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { fileReport, useReportReasons } from "@/api/queries";

/**
 * Report sheet.
 *
 * Confirms "sent" whatever the server did — the API returns a uniform 202 on
 * duplicate, unknown target and already-hidden content alike, and the UI must
 * not undo that by rendering a different outcome. A reporter who could tell
 * "already reported" from "reported" would have a probe.
 *
 * It also says plainly that no notification follows. Silence after a report
 * reads as being ignored unless you are told to expect it.
 */
export function ReportSheet({
  visible, targetType, targetId, onClose,
}: {
  visible: boolean;
  targetType: "post" | "comment" | "review" | "listing";
  targetId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data: reasons } = useReportReasons(targetType, visible);
  const [sent, setSent] = React.useState(false);

  const send = async (reasonKey: string) => {
    setSent(true);
    try {
      await fileReport({ targetType, targetId, reasonKey });
    } catch {
      // Deliberately swallowed: the sheet says "sent" either way, matching the
      // API's uniform response. A failure here is ours to see in telemetry,
      // not the reporter's to interpret.
    }
    setTimeout(() => { setSent(false); onClose(); }, 1200);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {sent ? (
            <Text style={[styles.sentText, { color: theme.colors.primary }]}>
              {t("forum.reportSent")}
            </Text>
          ) : (
            <>
              <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
                {t("forum.reportTitle")}
              </Text>

              {(reasons ?? []).map((r) => (
                <Pressable
                  key={r.key}
                  onPress={() => send(r.key)}
                  style={({ pressed }) => [
                    styles.reason,
                    {
                      backgroundColor: pressed ? theme.colors.surfaceAlt : "transparent",
                      borderColor: theme.colors.borderLight,
                    },
                  ]}
                >
                  <Text style={[styles.reasonText, { color: theme.colors.textPrimary }]}>{r.label}</Text>
                </Pressable>
              ))}

              <Text style={[styles.note, { color: theme.colors.textPlaceholder }]}>
                {t("forum.reportNote")}
              </Text>

              <Pressable onPress={onClose} style={styles.cancel}>
                <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t("forum.cancel")}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(20,28,36,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 10, borderTopRightRadius: 10, padding: 18, paddingBottom: 34, gap: 6 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 6 },
  reason: { borderWidth: 1, borderRadius: 4, paddingVertical: 12, paddingHorizontal: 12 },
  reasonText: { fontSize: 14 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 10 },
  cancel: { alignItems: "center", paddingVertical: 12, marginTop: 2 },
  cancelText: { fontSize: 14, fontWeight: "600" },
  sentText: { fontSize: 15, fontWeight: "600", textAlign: "center", paddingVertical: 28 },
});
