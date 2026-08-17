import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme/ThemeProvider";
import { useClassDetail } from "@/api/queries";
import { useRecordAbsence } from "@/api/mutations";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/**
 * The class detail sheet (design screen 04).
 *
 * The attendance block is the reason this screen exists. Everything else here
 * is a lookup a student could survive without; the absence count against the
 * exclusion limit is the thing they are actually anxious about, so it gets the
 * visual weight and the explicit consequence sentence rather than a bare
 * fraction.
 */
export function ClassDetailSheet({
  sectionId, onClose,
}: {
  sectionId: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isPending } = useClassDetail(sectionId);
  const record = useRecordAbsence(sectionId ?? "");
  const [justMarked, setJustMarked] = React.useState(false);

  const markToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    record.mutate(today, {
      onSuccess: () => {
        setJustMarked(true);
        setTimeout(() => setJustMarked(false), 2000);
      },
    });
  };

  const row = (label: string, value: string) => (
    <View style={[styles.row, { borderBottomColor: theme.colors.borderLight }]}>
      <Text style={[styles.rowLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[styles.rowValue, { color: theme.colors.textPrimary }]}>{value}</Text>
    </View>
  );

  const link = (label: string, count: number, unit: string, onPress?: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.link,
        {
          borderColor: theme.colors.borderLight,
          backgroundColor: pressed && onPress ? theme.colors.surfaceAlt : "transparent",
          opacity: onPress ? 1 : 0.55,
        },
      ]}
    >
      <Text style={[styles.linkLabel, { color: theme.colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.linkCount, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
        {count} {unit} {onPress ? "›" : ""}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={sectionId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />

          {isPending || !data ? (
            <ActivityIndicator color={theme.colors.primary} style={{ paddingVertical: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 28, gap: 18 }}>
              <View style={{ gap: 4 }}>
                <Text style={[styles.code, { color: theme.colors.textMuted, fontFamily: theme.fontFamilies.mono }]}>
                  {data.course_code}
                  {data.credits !== null ? ` · ${data.credits} ${t("classDetail.credits").toUpperCase()}` : ""}
                </Text>
                <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{data.course_title}</Text>
              </View>

              <View>
                {data.meetings.map((m) =>
                  row(
                    t("classDetail.time"),
                    `${t(`timetable.days.${DAY_KEYS[m.weekday - 1] ?? "mon"}`)} ${m.starts_at}–${m.ends_at}`,
                  ),
                )}
                {data.meetings[0]?.room
                  ? row(t("classDetail.room"), `${data.meetings[0].campus ?? ""}, ${data.meetings[0].room}`)
                  : null}
                {data.instructor
                  ? row(
                      t("classDetail.instructor"),
                      `${data.instructor.title_prefix ?? ""} ${data.instructor.full_name}`.trim() +
                        (data.instructor.rating_avg !== null
                          ? `  ${Number(data.instructor.rating_avg).toFixed(1)} ★`
                          : ""),
                    )
                  : null}
              </View>

              {/* Attendance: the reason this sheet exists. */}
              <View
                style={[
                  styles.attendance,
                  {
                    borderColor: data.attendance.is_barred
                      ? theme.colors.urgent
                      : data.attendance.is_warning
                        ? theme.colors.secondary
                        : theme.colors.border,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
              >
                <Text style={[styles.rowLabel, { color: theme.colors.textPlaceholder, fontFamily: theme.fontFamilies.mono }]}>
                  {t("classDetail.attendance").toUpperCase()}
                </Text>
                <Text style={[styles.count, { color: theme.colors.textPrimary }]}>
                  {data.attendance.absences} / {data.attendance.max_absences}
                </Text>
                <View style={[styles.barTrack, { backgroundColor: theme.colors.borderLight }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.min(100, Math.round(data.attendance.used_ratio * 100))}%`,
                        backgroundColor: data.attendance.is_barred
                          ? theme.colors.urgent
                          : data.attendance.is_warning
                            ? theme.colors.secondary
                            : theme.colors.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.limitNote, { color: theme.colors.textMuted }]}>
                  {data.attendance.is_barred
                    ? t("classDetail.barred")
                    : t("classDetail.limitNote", {
                        pct: Math.round(data.attendance.used_ratio * 100),
                        limit: data.attendance.expulsion_at,
                      })}
                </Text>
              </View>

              <View style={{ gap: 0 }}>
                {link(t("classDetail.materials"), data.material_count, t("classDetail.files"))}
                {link(t("classDetail.topics"), data.board_topic_count, t("classDetail.topicsCount"))}
                {link(
                  t("classDetail.reviews"),
                  data.review_count,
                  t("classDetail.reviewsCount"),
                  data.instructor
                    ? () => {
                        onClose();
                        router.push({
                          pathname: "/reviews/instructor/[id]",
                          params: { id: data.instructor!.id },
                        });
                      }
                    : undefined,
                )}
              </View>

              {data.enrollment_id ? (
                <View style={{ gap: 8 }}>
                  <Pressable
                    disabled={record.isPending}
                    onPress={markToday}
                    style={[
                      styles.markBtn,
                      {
                        backgroundColor: justMarked ? theme.colors.primaryLight : "transparent",
                        borderColor: theme.colors.primary,
                      },
                    ]}
                  >
                    <Text style={[styles.markText, { color: theme.colors.primary }]}>
                      {record.isPending
                        ? t("classDetail.marking")
                        : justMarked
                          ? t("classDetail.marked")
                          : t("classDetail.markAbsence")}
                    </Text>
                  </Pressable>
                  {/* A student must not believe this reached their faculty. */}
                  <Text style={[styles.selfNote, { color: theme.colors.textPlaceholder }]}>
                    {t("classDetail.selfReported")}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.selfNote, { color: theme.colors.textPlaceholder }]}>
                  {t("classDetail.notEnrolled")}
                </Text>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(20,28,36,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderTopLeftRadius: 12, borderTopRightRadius: 12,
    padding: 18, paddingTop: 10, maxHeight: "88%",
  },
  grabber: { width: 34, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  code: { fontSize: 10, letterSpacing: 1.2 },
  title: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3, lineHeight: 26 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, gap: 12 },
  rowLabel: { fontSize: 9, letterSpacing: 1 },
  rowValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  attendance: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 7 },
  count: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  barTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 5 },
  limitNote: { fontSize: 12, lineHeight: 17 },
  link: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  linkLabel: { fontSize: 14, fontWeight: "600" },
  linkCount: { fontSize: 11 },
  markBtn: { borderWidth: 1, borderRadius: 4, paddingVertical: 12, alignItems: "center" },
  markText: { fontSize: 14, fontWeight: "600" },
  selfNote: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
