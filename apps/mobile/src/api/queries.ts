import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import type {
  Attendance, Board, ClassDetail, Conversation, ConversationSummary, Listing, MarketCategory,
  InstructorProfile, MyModerationAction, MyProfile, PostDetail, PostPage, Reviewable,
  ReviewPage, ReviewTag, Today, Vacancy, WeekGrid,
  CourseHit, InstructorHit, ListingHit, PostHit, SearchPage, VacancyHit,
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

export function useMarketCategories() {
  return useQuery({
    queryKey: ["market", "categories"],
    queryFn: () => apiGet<MarketCategory[]>("/market/categories"),
    staleTime: 60 * 60 * 1000,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: ["market", "conversations"],
    queryFn: () => apiGet<ConversationSummary[]>("/market/conversations"),
    staleTime: 15 * 1000,
    retry: 1,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["market", "conversation", id],
    queryFn: () => apiGet<Conversation>(`/market/conversations/${id}`),
    enabled: Boolean(id),
    // A live negotiation: poll while the screen is open. Realtime would be
    // better and is the natural upgrade, but polling is honest and cheap.
    refetchInterval: 8000,
    retry: 1,
  });
}

/**
 * The professor profile. Aggregates only — ungated by design, because a
 * rating summary is what makes the contribution wall worth climbing.
 */
export function useInstructor(id: string | null) {
  return useQuery({
    queryKey: ["reviews", "instructor", id],
    queryFn: () => apiGet<InstructorProfile>(`/reviews/instructors/${id}`),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Written reviews, optionally narrowed to one course.
 *
 * Returns 200 with an empty list and the wall's state when the caller has not
 * contributed, so this is never an error path.
 */
export function useInstructorReviews(id: string | null, courseId?: string | null) {
  return useQuery({
    queryKey: ["reviews", "instructor", id, "reviews", courseId ?? "all"],
    queryFn: () =>
      apiGet<ReviewPage>(
        `/reviews/instructors/${id}/reviews${courseId ? `?course_id=${courseId}` : ""}`,
      ),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/** The closed tag vocabulary. Changes about never, so it caches hard. */
export function useReviewTags() {
  return useQuery({
    queryKey: ["reviews", "tags"],
    queryFn: () => apiGet<ReviewTag[]>("/reviews/tags"),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/** Course × instructor pairs the caller may review this term. */
export function useReviewable() {
  return useQuery({
    queryKey: ["reviews", "reviewable"],
    queryFn: () => apiGet<Reviewable[]>("/reviews/reviewable"),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * What has been done to my content.
 *
 * Not cached long: a student who has just filed an appeal will pull to refresh
 * looking for an answer, and showing them a stale "waiting" for minutes
 * afterwards is the wrong side to err on.
 */
export function useMyModeration() {
  return useQuery({
    queryKey: ["me", "moderation"],
    queryFn: () => apiGet<MyModerationAction[]>("/me/moderation"),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Global search (HM-03 – HM-06)
// ---------------------------------------------------------------------------

/**
 * The API's `q` has `minLength: 2`, so firing below that is a guaranteed 422.
 * Queries stay disabled until the field holds two characters.
 */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Debounce before a keystroke becomes a request.
 *
 * Not a UI nicety — a budget. All five endpoints share the `search.query`
 * bucket (120/hour at the email tier) and the "all" scope spends three of it
 * per query, so an undebounced field would exhaust an hour's allowance in
 * about a dozen words typed.
 */
export const SEARCH_DEBOUNCE_MS = 350;

/**
 * One shared shape for all five corpora.
 *
 * `useInfiniteQuery` rather than `useQuery` even though the "all" chip never
 * pages: two hook families for the same five endpoints would have drifted, and
 * the cost of the infinite variant when nothing pages it is one array to
 * flatten. `getNextPageParam` returns the API's opaque `next_cursor` verbatim —
 * the cursor is HMAC-signed and bound to this exact query, so it must be handed
 * back byte-for-byte and must never be parsed, constructed or cached across a
 * changed query.
 */
function searchPages<T>(
  key: string,
  build: (cursorParam: string) => string,
  q: string,
  enabled: boolean,
) {
  return {
    queryKey: ["search", key, q],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      apiGet<SearchPage<T>>(build(pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "")),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SearchPage<T>) => last.next_cursor,
    enabled: enabled && q.trim().length >= SEARCH_MIN_LENGTH,
    // A given query string returns the same thing for a while; re-typing a
    // recent search should not cost another bucket slot.
    staleTime: 60 * 1000,
    retry: 1,
  } as const;
}

const enc = encodeURIComponent;

export function useSearchPosts(q: string, enabled = true, limit = 20) {
  return useInfiniteQuery(searchPages<PostHit>(
    `posts:${limit}`, (c) => `/search/posts?q=${enc(q)}&limit=${limit}${c}`, q, enabled));
}

export function useSearchCourses(q: string, enabled = true, limit = 20) {
  return useInfiniteQuery(searchPages<CourseHit>(
    `courses:${limit}`, (c) => `/search/courses?q=${enc(q)}&limit=${limit}${c}`, q, enabled));
}

export function useSearchInstructors(q: string, enabled = true, limit = 20) {
  return useInfiniteQuery(searchPages<InstructorHit>(
    `instructors:${limit}`, (c) => `/search/instructors?q=${enc(q)}&limit=${limit}${c}`, q, enabled));
}

export function useSearchListings(q: string, enabled = true, limit = 20) {
  return useInfiniteQuery(searchPages<ListingHit>(
    `listings:${limit}`, (c) => `/search/listings?q=${enc(q)}&limit=${limit}${c}`, q, enabled));
}

export function useSearchVacancies(q: string, enabled = true, limit = 20) {
  return useInfiniteQuery(searchPages<VacancyHit>(
    `vacancies:${limit}`, (c) => `/search/vacancies?q=${enc(q)}&limit=${limit}${c}`, q, enabled));
}

/** Flattens the page list into the flat array every result surface renders. */
export function flattenPages<T>(data: { pages: Array<SearchPage<T>> } | undefined): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}
