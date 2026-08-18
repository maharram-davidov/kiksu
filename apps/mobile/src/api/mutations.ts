import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPatch, apiPost } from "./client";
import type {
  AccentColor, ChatMessage, Comment, Conversation, Enrollment, Listing, ListingCondition,
  MyProfile, PostDetail, PrivacyKey,
  ReviewAccess,
} from "./types";

/**
 * Optimistic vote.
 *
 * A vote is the cheapest possible interaction and the one most likely to
 * happen on bad campus wifi, so the arrow flips immediately and rolls back if
 * the server disagrees. The rollback matters: silently keeping a vote the
 * server rejected would show a student a score that does not exist.
 */
export function useVotePost(postId: string) {
  const qc = useQueryClient();
  const key = ["forum", "post", postId];

  return useMutation({
    mutationFn: (value: -1 | 0 | 1) =>
      apiPost<{ score: number; your_vote: -1 | 0 | 1 }>(`/forum/posts/${postId}/vote`, { value }),
    onMutate: async (value) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PostDetail>(key);
      if (previous) {
        // The server owns the real arithmetic; this is a local guess that
        // assumes no prior vote, which is the common case.
        qc.setQueryData<PostDetail>(key, { ...previous, score: previous.score + value });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useSavePost(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) =>
      apiPost<{ saved: boolean; save_count: number }>(`/forum/posts/${postId}/save`, { saved }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["forum", "post", postId] }),
  });
}

/**
 * Posts a comment.
 *
 * Deliberately NOT optimistic. The alias is assigned by the server inside the
 * same transaction as the insert, so an optimistic comment would have to guess
 * its own "Anonim N" — and showing the wrong ordinal, even for a second, would
 * undermine the one thing the numbering exists to make trustworthy.
 */
export function useCreateComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiPost<Comment>(`/forum/posts/${postId}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum", "post", postId] }),
  });
}

/**
 * Privacy toggles, updated optimistically.
 *
 * A switch that lags behind the finger feels broken, and these are controls a
 * student is likely to flip several times while reading what each one does.
 * The rollback matters more than usual here: leaving a toggle showing "on"
 * when the server rejected it would misrepresent what the app is disclosing.
 */
export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Record<PrivacyKey, boolean>>) =>
      apiPatch<MyProfile>("/me/privacy", patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["me"] });
      const previous = qc.getQueryData<MyProfile>(["me"]);
      if (previous) {
        qc.setQueryData<MyProfile>(["me"], {
          ...previous,
          privacy: { ...previous.privacy, ...patch },
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(["me"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

/** Handle rotation is NOT optimistic: the new name is generated server-side. */
export function useRotateHandle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ handle: string }>("/me/handle/rotate", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

/**
 * Records a self-reported absence.
 *
 * NOT optimistic. This number can end in exclusion from an exam, so a count
 * that briefly showed 5/12 and settled back to 4/12 would be alarming in a way
 * a vote count never is. Better a moment's wait than a moment's fright.
 */
export function useRecordAbsence(sectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (occurredOn: string) =>
      apiPost<{ absences: number; max_absences: number }>(
        `/timetable/sections/${sectionId}/absence`,
        { occurred_on: occurredOn },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timetable", "section", sectionId] });
      qc.invalidateQueries({ queryKey: ["timetable", "attendance"] });
    },
  });
}

/** Creating a listing is never optimistic: the server assigns the id. */
/**
 * Start a thread.
 *
 * `show_university_badge` is sent per post and never remembered. The design
 * treats the campus badge as a disclosure rather than a preference, and the
 * server rejects it outright on anything but a national board — a badge on a
 * campus board would say nothing except "this student is from here", which
 * everyone on that board already is.
 */
export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      boardSlug: string; title: string; body?: string; showUniversityBadge?: boolean;
    }) =>
      apiPost<PostDetail>("/forum/posts", {
        board_slug: input.boardSlug,
        title: input.title,
        body: input.body,
        show_university_badge: input.showUniversityBadge ?? false,
      }),
    onSuccess: (_data, vars) => {
      // The board feed and the board list both carry counters the new thread
      // just changed.
      void qc.invalidateQueries({ queryKey: ["forum", "board", vars.boardSlug] });
      void qc.invalidateQueries({ queryKey: ["forum", "boards"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      categoryKey: string; title: string; description?: string;
      priceMinor: number; isNegotiable: boolean; condition: ListingCondition;
      meetupNotes: string[];
    }) =>
      apiPost<Listing>("/market/listings", {
        category_key: input.categoryKey,
        title: input.title,
        description: input.description,
        price_minor: input.priceMinor,
        is_negotiable: input.isNegotiable,
        condition: input.condition,
        meetup_notes: input.meetupNotes,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["market", "listings"] }),
  });
}

export function useOpenConversation() {
  return useMutation({
    mutationFn: (listingId: string) =>
      apiPost<Conversation>(`/market/listings/${listingId}/conversation`, {}),
  });
}

/**
 * Sends a message or a structured offer.
 *
 * Not optimistic: the server decides whether the classifier limits it, and
 * showing a message as delivered that then turns out to be limited would
 * mislead the sender about what the other person can actually see.
 */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body?: string; offerPriceMinor?: number }) =>
      apiPost<ChatMessage>(`/market/conversations/${conversationId}/messages`, {
        body: input.body,
        offer_price_minor: input.offerPriceMinor,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market", "conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["market", "conversations"] });
    },
  });
}

/**
 * Writes a review.
 *
 * The five ratings are required and the prose is not, mirroring the server's
 * own reasoning: an average of numbers is what the product can defend, and the
 * paragraph is what students come for.
 *
 * On success this invalidates the whole reviews tree rather than patching it.
 * A new review changes the instructor's aggregates, the review list, the
 * caller's remaining reviewable pairs, AND the contribution wall — four
 * surfaces, and getting any one of them wrong locally would show a student a
 * wall they have already climbed.
 */
export function useWriteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      course_id: string;
      instructor_id: string;
      overall_rating: number;
      quality: number;
      fairness: number;
      workload: number;
      attendance_strictness: number;
      tags: string[];
      body?: string;
    }) => apiPost<{ id: string; access: ReviewAccess }>("/reviews", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews"] }),
  });
}

/**
 * Files an appeal against a moderation decision.
 *
 * Invalidates the whole `me` tree rather than patching: filing changes the
 * action's own row (it becomes un-appealable) and adds an appeal state, and
 * getting either wrong locally would show a student an appeal button that no
 * longer does anything.
 */
export function useFileAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { action_id: string; body: string }) =>
      apiPost<{ id: string; state: string }>("/me/appeals", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

// ---------------------------------------------------------------------------
// Timetable editing
// ---------------------------------------------------------------------------

/**
 * The three writes share one invalidation set, because all three change the
 * week grid as well as the enrollment list — a course added, dropped or
 * recoloured is visible on the grid immediately or the editor feels broken.
 */
function timetableKeys(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["enrollments"] });
  void qc.invalidateQueries({ queryKey: ["timetable", "week"] });
  void qc.invalidateQueries({ queryKey: ["timetable", "attendance"] });
  void qc.invalidateQueries({ queryKey: ["today"] });
  void qc.invalidateQueries({ queryKey: ["catalogue", "sections"] });
}

export function useAddEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sectionId: string; color?: AccentColor }) =>
      apiPost<Enrollment>("/enrollments", { section_id: input.sectionId, color: input.color }),
    onSuccess: () => timetableKeys(qc),
  });
}

/**
 * Drop. The server treats this as a state change rather than a delete so
 * absence history survives — see `EnrollmentsService` on the API side. From
 * the client's point of view the course simply leaves the grid.
 */
export function useDropEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string) => apiDelete<void>(`/enrollments/${enrollmentId}`),
    onSuccess: () => timetableKeys(qc),
  });
}

export function useRecolourEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrollmentId: string; color: AccentColor }) =>
      apiPatch<Enrollment>(`/enrollments/${input.enrollmentId}`, { color: input.color }),
    onSuccess: () => timetableKeys(qc),
  });
}
