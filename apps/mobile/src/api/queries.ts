import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import type {
  Attendance, Board, Listing, PostDetail, PostPage, Today, Vacancy, WeekGrid,
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
