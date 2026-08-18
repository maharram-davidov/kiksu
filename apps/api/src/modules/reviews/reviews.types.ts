/**
 * Review shapes.
 *
 * A review carries NO author field of any kind — not an alias, not a tier.
 * `public.review` has no author column at all; authorship lives in
 * internal.review_author, which this connection cannot reach. Reviews are
 * unlike forum posts in that even a per-thread ordinal would be too much: a
 * course has few enough students that "Anonim 3" plus a semester narrows hard.
 */
export interface ReviewDto {
  id: string;
  course_code: string;
  course_title: string;
  term_label: string;
  overall_rating: number;
  quality: number;
  fairness: number;
  workload: number;
  attendance_strictness: number;
  tags: Array<{ key: string; label: string; polarity: string }>;
  body: string | null;
  /** The design's "DOĞRULANMIŞ" — the reviewer was enrolled in this section. */
  is_enrollment_verified: boolean;
  created_at: string;
}

/**
 * The contribution wall's state, embedded in every review page.
 *
 * Modelled as data rather than a surprise 403 so the client can render the
 * wall as a prompt — "write one and this opens" — instead of an error. A wall
 * a student hits by accident teaches nothing; one they can see coming is a
 * bargain they can choose to take.
 */
export interface ReviewAccessDto {
  can_read_text: boolean;
  written_this_term: number;
  required_this_term: number;
}

export interface InstructorProfileDto {
  id: string;
  full_name: string;
  title_prefix: string | null;
  department: string | null;
  university_code: string;
  review_count: number;
  course_count: number;
  rating_avg: number | null;
  /** star_1..star_5, index 0 = one star. Renders the design's histogram. */
  histogram: number[];
  criteria: {
    quality: number | null;
    fairness: number | null;
    workload: number | null;
    attendance_strictness: number | null;
  };
  top_tags: Array<{ key: string; label: string; polarity: string }>;
  courses: Array<{ id: string; code: string; title: string; review_count: number; rating_avg: number | null }>;
}

export interface ReviewPageDto {
  access: ReviewAccessDto;
  items: ReviewDto[];
}

/**
 * One entry of the tag vocabulary (`ref.review_tag`).
 *
 * Exposed because the composer has to render selectable chips and `POST /reviews`
 * rejects unknown keys with `review_tag_unknown` (422) — the client cannot guess
 * them, so without this endpoint the tag half of a review is unwritable.
 *
 * The vocabulary is deliberately CLOSED (see the comment above the seed in
 * supabase/seed.sql): reviews are free text about a named person, and an open
 * tag list would become a place to write the things the prose guardrails exist
 * to prevent.
 */
export interface ReviewTagDto {
  key: string;
  /** Resolved for the request's locale, falling back to Azerbaijani. */
  label: string;
  polarity: string;
  /** 'instructor' | 'course' | 'both' — lets the composer group the chips. */
  applies_to: string;
}

/**
 * A course × instructor pair the caller may review this term.
 *
 * Needed because the composer cannot be driven from the instructor profile:
 * `InstructorProfileDto.courses` only lists courses that ALREADY have reviews,
 * so an instructor with none — precisely the cold-start case the contribution
 * wall exists to solve — would offer an empty picker.
 *
 * Sourced from the caller's own enrollments, which is also what RV-07 in the
 * product plan means by "pre-fills from your timetable".
 */
export interface ReviewableDto {
  course_id: string;
  course_code: string;
  course_title: string;
  instructor_id: string;
  instructor_name: string;
  term_label: string;
}
