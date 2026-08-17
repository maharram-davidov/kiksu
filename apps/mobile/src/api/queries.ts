import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import type {
  Attendance, Board, ClassDetail, Listing, MyProfile, PostDetail, PostPage, Today, Vacancy, WeekGrid,
} from "./types";

export function useWeekGrid() {
  return useQuery({
    queryKey: ["timetable", "week"],
    queryFn: () => apiGet<WeekGrid>("/timetable/week"),
    // A timetable changes at most a few times a semester; refetching it on
    // every focus would burn campus wifi for nothing.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useAttendance() {
  return useQuery({
    queryKey: ["timetable", "attendance"],
    queryFn: () => apiGet<Attendance[]>("/timetable/attendance"),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useBoards() {
  return useQuery({
    queryKey: ["forum", "boards"],
    queryFn: () => apiGet<Board[]>("/forum/boards"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useBoardFeed(slug: string) {
  return useQuery({
    queryKey: ["forum", "board", slug],
    queryFn: () => apiGet<PostPage>(`/forum/boards/${encodeURIComponent(slug)}/posts`),
    // Feeds move; 30s keeps a back-navigation instant without serving
    // yesterday's board.
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: ["forum", "post", id],
    queryFn: () => apiGet<PostDetail>(`/forum/posts/${encodeURIComponent(id)}`),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: () => apiGet<Today>("/today"),
    // "What is left today" goes stale as the day moves, so this is short and
    // refetches when the app comes back to the foreground.
    staleTime: 60 * 1000,
    refetchOnMount: true,
    retry: 1,
  });
}

export function useListings(category?: string) {
  return useQuery({
    queryKey: ["market", "listings", category ?? "all"],
    queryFn: () =>
      apiGet<Listing[]>(`/market/listings${category ? `?category=${encodeURIComponent(category)}` : ""}`),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useVacancies(kind?: string) {
  return useQuery({
    queryKey: ["careers", "vacancies", kind ?? "all"],
    queryFn: () =>
      apiGet<Vacancy[]>(`/careers/vacancies${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export interface UniversityOption {
  id: string;
  code: string;
  name: string;
  city: string;
  email_sample: string | null;
  routes: string[];
}

/** Public: needed before the caller has any identity at all. */
export function useUniversities() {
  return useQuery({
    queryKey: ["onboarding", "universities"],
    queryFn: () => apiGet<UniversityOption[]>("/onboarding/universities"),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export function startEmailVerification(email: string) {
  return apiPost<{ expires_in_seconds: number }>("/onboarding/verify/email/start", { email });
}

export function confirmEmailVerification(email: string, code: string, authUserId: string) {
  return apiPost<{ app_user_id: string; handle: string; tier: string }>(
    "/onboarding/verify/email/confirm",
    { email, code, auth_user_id: authUserId },
  );
}

export function submitCardVerification(input: {
  universityId: string; authUserId: string; evidencePath: string; evidenceSha256: string;
}) {
  return apiPost<{ state: string; sla_due_at: string }>("/onboarding/verify/card", {
    university_id: input.universityId,
    auth_user_id: input.authUserId,
    evidence_path: input.evidencePath,
    evidence_sha256: input.evidenceSha256,
  });
}

export function useVerificationStatus(authUserId: string) {
  return useQuery({
    queryKey: ["onboarding", "status", authUserId],
    queryFn: () =>
      apiGet<{ state: string; method: string | null; sla_due_at: string | null }>(
        `/onboarding/verify/status?auth_user_id=${encodeURIComponent(authUserId)}`,
      ),
    enabled: authUserId.length > 0,
    // A human is deciding, so polling hard achieves nothing but battery drain.
    refetchInterval: 30_000,
    retry: 1,
  });
}

export interface ReportReason { key: string; label: string; severity: number }

export function useReportReasons(targetType: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "reasons", targetType],
    queryFn: () => apiGet<ReportReason[]>(`/reports/reasons?target_type=${targetType}`),
    enabled,
    staleTime: 60 * 60 * 1000,
  });
}

export function fileReport(input: {
  targetType: string; targetId: string; reasonKey: string; details?: string;
}) {
  return apiPost<void>("/reports", {
    target_type: input.targetType,
    target_id: input.targetId,
    reason_key: input.reasonKey,
    details: input.details,
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<MyProfile>("/me"),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function useClassDetail(sectionId: string | null) {
  return useQuery({
    queryKey: ["timetable", "section", sectionId],
    queryFn: () => apiGet<ClassDetail>(`/timetable/sections/${sectionId}`),
    enabled: Boolean(sectionId),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useListing(id: string | null) {
  return useQuery({
    queryKey: ["market", "listing", id],
    queryFn: () => apiGet<Listing>(`/market/listings/${id}`),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    retry: 1,
  });
}
