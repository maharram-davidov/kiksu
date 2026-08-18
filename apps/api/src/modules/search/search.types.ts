/**
 * Global search response shapes (HM-03 – HM-06).
 *
 * THE RULE FOR THIS FILE, in two halves:
 *
 * 1. **There is no people corpus and there never will be.** Identity spec T11
 *    permits exact-full-handle lookup only — prefix, substring and fuzzy
 *    matching let an attacker walk the adjective x noun space and enumerate the
 *    whole user base together with each user's rendered university and year.
 *    Nothing in this file may accept or return a handle *as a search key*.
 *
 * 2. **No single response mixes a thread alias with a handle.** Post results
 *    carry an alias (Layer 3); listing results carry the seller's handle
 *    (Layer 2 — the marketplace is handle-attributed by product necessity, a
 *    seller with no persistent reputation is a scam waiting to happen).
 *    Assertion 21 asserts no client-facing response contains both. That is why
 *    global search is five endpoints rather than one aggregate: the aggregate
 *    would put both in one payload. The client fans out and merges for display.
 */

/** Shared page envelope. Cursor is opaque and signed — see CursorService. */
export interface SearchPageDto<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * HM-04. Deliberately the same author shape the forum feed uses: an ordinal
 * plus a coarse tier. Search is a wider fan-out than a board feed, so a field
 * that would be merely unwise there is a correlation gift here.
 */
export interface PostHitDto {
  id: string;
  title: string;
  excerpt: string | null;
  board: { slug: string; name: string };
  /** Null for national boards, which is also how the client separates the two groups. */
  board_university_code: string | null;
  scope: "campus" | "national";
  author: { alias_number: number; tier: "unverified" | "email" | "card" };
  /** Opt-in campus badge, national boards only. */
  author_university_code: string | null;
  score: number;
  comment_count: number;
  created_at: string;
}

/** HM-05, courses half. Rating summary inline so the result list is useful on its own. */
export interface CourseHitDto {
  id: string;
  code: string;
  title: string;
  credits: number | null;
  department: string | null;
  /** From public.course_review_summary. Null when the course has no reviews yet. */
  rating_avg: number | null;
  review_count: number;
}

/** HM-05, professors half. Instructor names are real and public — this is a review product. */
export interface InstructorHitDto {
  id: string;
  full_name: string;
  title_prefix: string | null;
  department: string | null;
  /** From public.instructor_review_summary. */
  rating_avg: number | null;
  review_count: number;
  course_count: number;
}

/**
 * HM-06, listings half. Carries the seller handle because the marketplace is
 * Layer 2 always — see the file header for why that forces the endpoint split.
 */
export interface ListingHitDto {
  id: string;
  title: string;
  excerpt: string | null;
  category_key: string;
  category_name: string;
  /** Integer minor units. 25 manat is 2500; converted to major units once, at render. */
  price_minor: number;
  currency: string;
  is_negotiable: boolean;
  condition: string;
  related_course_code: string | null;
  seller: { handle: string; avatar_id: number; contributor_level: number | null } | null;
  published_at: string;
}

/** HM-06, jobs half. Same results shape, different sort axis (deadline, not price). */
export interface VacancyHitDto {
  id: string;
  title: string;
  excerpt: string | null;
  kind: string;
  work_mode: string;
  city: string | null;
  is_paid: boolean;
  stipend_minor: number | null;
  currency: string;
  apply_deadline: string | null;
  /** Powers the "3 GÜN" countdown chip. Null when the vacancy has no deadline. */
  days_left: number | null;
  employer: { slug: string; name: string; logo_initials: string | null; brand_color: string | null };
}

export type ListingSort = "relevance" | "price_asc" | "price_desc" | "newest";
export type VacancySort = "relevance" | "deadline" | "newest";
export type PostScope = "all" | "campus" | "national";
