/** Mirrors the API's timetable DTOs. Kept minimal — only what screens render. */

export interface Meeting {
  section_id: string;
  course_code: string;
  course_title: string;
  /** ISO-8601 weekday: 1 = Monday (B.E). */
  weekday: number;
  starts_at: string;
  ends_at: string;
  room: string | null;
  campus: string | null;
  kind: string;
  instructor: string | null;
}

export interface WeekGrid {
  term: { id: string; label: string; starts_on: string; ends_on: string };
  /** The zone the wall-clock times above are interpreted in. Never an instant. */
  timezone: string;
  meetings: Meeting[];
}

export interface Attendance {
  section_id: string;
  course_code: string;
  course_title: string;
  absences: number;
  max_absences: number;
  expulsion_at: number;
  used_ratio: number;
  is_warning: boolean;
  is_barred: boolean;
}

/**
 * An anonymous author, as the wire represents them.
 *
 * These three fields are ALL the client ever receives about who wrote
 * something. There is no handle and no user id, by construction — see
 * apps/api/src/modules/forum/forum.types.ts. Nothing in the app should try to
 * key state off an author, because two posts by the same person are not
 * knowably by the same person, and that is the point.
 */
export interface AliasAuthor {
  alias_number: number;
  tier: "unverified" | "email" | "card";
  is_op: boolean;
}

export interface Board {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: string;
  follower_count: number;
  post_count: number;
  university_code: string | null;
}

export interface PostSummary {
  id: string;
  title: string;
  excerpt: string | null;
  kind: string;
  author: AliasAuthor;
  /** Opt-in campus badge. Null unless the author ticked it, national boards only. */
  author_university_code: string | null;
  score: number;
  comment_count: number;
  save_count: number;
  created_at: string;
}

export interface PostPage {
  items: PostSummary[];
  next_cursor: string | null;
}

export interface Comment {
  id: string;
  author: AliasAuthor;
  body: string;
  score: number;
  depth: number;
  created_at: string;
}

export interface PostDetail {
  id: string;
  board: { slug: string; name: string };
  title: string;
  body: string | null;
  kind: string;
  author: AliasAuthor;
  author_university_code: string | null;
  score: number;
  comment_count: number;
  save_count: number;
  created_at: string;
  poll: {
    question: string;
    total_votes: number;
    closes_at: string | null;
    options: Array<{ position: number; label: string; vote_count: number }>;
  } | null;
  comments: Comment[];
  /** The ordinal this reader would get if they commented. "ANONİM 5 KİMİ YAZ". */
  your_next_alias: number;
}

export interface TodayClass {
  section_id: string;
  course_code: string;
  course_title: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  campus: string | null;
  instructor: string | null;
  /** Computed server-side in the university's zone, never from the phone clock. */
  starts_in_minutes: number;
  is_in_progress: boolean;
}

export interface TodayDeadline {
  id: string;
  title: string;
  course_code: string;
  due_at: string;
  days_left: number;
}

export interface TodayPost {
  id: string;
  title: string;
  board_name: string;
  board_slug: string;
  score: number;
  comment_count: number;
}

export interface Today {
  date: string;
  weekday: number;
  timezone: string;
  remaining_classes: TodayClass[];
  deadlines: TodayDeadline[];
  hot_posts: TodayPost[];
}

/**
 * A seller is pseudonymous but PERSISTENT — unlike a forum author they carry a
 * handle and a rating. That is the one place the product trades anonymity for
 * accountability: someone meeting a stranger to hand over cash needs something
 * to go on. It does not link to their forum or review activity.
 */
export interface Seller {
  handle: string;
  avatar_id: number;
  university_code: string | null;
  verification_status: "card" | "email" | "none";
  trade_rating_avg: number | null;
  deal_count: number;
  response_rate_pct: number | null;
  response_time_median_sec: number | null;
  complaint_count: number;
}

export interface Listing {
  id: string;
  title: string;
  description: string | null;
  category_key: string;
  category_name: string;
  /** Minor units (qəpik). Divide by 100 only at render time. */
  price_minor: number;
  currency: string;
  is_negotiable: boolean;
  condition: string;
  meetup_notes: string[];
  related_course_code: string | null;
  published_at: string;
  seller: Seller | null;
}

export interface Vacancy {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  work_mode: string;
  city: string | null;
  is_paid: boolean;
  stipend_minor: number | null;
  currency: string;
  duration_months: number | null;
  hours_per_week: number | null;
  min_study_year: number | null;
  max_study_year: number | null;
  required_skills: string[];
  conversion_possible: boolean;
  transport_provided: boolean;
  schedule_friendly: boolean;
  apply_deadline: string | null;
  days_left: number | null;
  /** Where applying happens. Kiksu hands off; it does not take applications. */
  external_url: string | null;
  employer: { slug: string; name: string; logo_initials: string | null; brand_color: string | null };
}


export interface MyProfile {
  handle: string;
  avatar_id: number;
  /** Exact, and ONLY here. No cross-user surface carries this. */
  karma: number;
  post_count: number;
  comment_count: number;
  review_count: number;
  trade_rating_avg: number | null;
  deal_count: number;
  /**
   * The token vocabulary: 'provisional' | 'email' | 'card'. The same string
   * the access token carries, so a screen never has to know which surface a
   * tier came from.
   */
  verification_tier: "provisional" | "email" | "card";
  /** Independent of tier: you can be email-verified with a card pending. */
  card_review_state: string;
  university_code: string | null;
  study_year: number | null;
  handle_change_allowed_at: string;
  can_change_handle: boolean;
  privacy: {
    show_year: boolean;
    share_timetable: boolean;
    show_uni_badge: boolean;
    link_listings: boolean;
    discoverable: boolean;
  };
}

export type PrivacyKey = keyof MyProfile["privacy"];


export interface ClassDetail {
  section_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  credits: number | null;
  section_code: string | null;
  meetings: Array<{
    weekday: number; starts_at: string; ends_at: string;
    room: string | null; campus: string | null; kind: string;
  }>;
  instructor: {
    id: string; full_name: string; title_prefix: string | null;
    rating_avg: number | null; review_count: number;
  } | null;
  attendance: {
    absences: number; max_absences: number; expulsion_at: number;
    used_ratio: number; is_warning: boolean; is_barred: boolean;
  };
  material_count: number;
  board_topic_count: number;
  review_count: number;
  /** Null when not enrolled — the sheet hides absence recording. */
  enrollment_id: string | null;
}


export interface MarketCategory { id: string; key: string; name: string }

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor";


export interface ChatParticipant {
  app_user_id: string;
  handle: string;
  avatar_id: number;
  verification_status: "card" | "email" | "none";
  trade_rating_avg: number | null;
  is_seller: boolean;
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  offer_price_minor: number | null;
  created_at: string;
  /** Classifier limited it; the client renders a placeholder, not the text. */
  is_limited: boolean;
}

export interface Conversation {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  listing_price_minor: number | null;
  participants: ChatParticipant[];
  messages: ChatMessage[];
  is_closed: boolean;
}

export interface ConversationSummary {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  listing_price_minor: number | null;
  other: ChatParticipant | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_closed: boolean;
}

// ---------------------------------------------------------------------------
// Reviews (design screen 07)
// ---------------------------------------------------------------------------

/**
 * One written review.
 *
 * NOTE WHAT IS ABSENT: there is no author field of any kind — not a handle,
 * not a per-thread alias, not a tier. That is stricter than forum posts and
 * deliberately so: a course cohort is small enough that "Anonim 3, spring
 * term" narrows to a handful of people. The API cannot send one, and nothing
 * on the screen may synthesise one.
 */
export interface Review {
  id: string;
  course_code: string;
  course_title: string;
  term_label: string;
  overall_rating: number;
  quality: number;
  fairness: number;
  workload: number;
  attendance_strictness: number;
  tags: ReviewTag[];
  body: string | null;
  /** The design's "DOĞRULANMIŞ" — the reviewer was enrolled in this section. */
  is_enrollment_verified: boolean;
  created_at: string;
}

export interface ReviewTag {
  key: string;
  label: string;
  polarity: string;
  applies_to?: string;
}

/**
 * The contribution wall's state.
 *
 * Arrives on the review page rather than as a 403, so the screen renders a
 * bargain — "write one and this opens" — instead of an error.
 */
export interface ReviewAccess {
  can_read_text: boolean;
  written_this_term: number;
  required_this_term: number;
}

export interface InstructorProfile {
  id: string;
  full_name: string;
  title_prefix: string | null;
  department: string | null;
  university_code: string;
  review_count: number;
  course_count: number;
  rating_avg: number | null;
  /** star_1..star_5, index 0 = one star. */
  histogram: number[];
  criteria: {
    quality: number | null;
    fairness: number | null;
    workload: number | null;
    attendance_strictness: number | null;
  };
  top_tags: ReviewTag[];
  courses: Array<{ id: string; code: string; title: string; review_count: number; rating_avg: number | null }>;
}

export interface ReviewPage {
  access: ReviewAccess;
  items: Review[];
}

/** A course × instructor pair the caller may review this term. */
export interface Reviewable {
  course_id: string;
  course_code: string;
  course_title: string;
  instructor_id: string;
  instructor_name: string;
  term_label: string;
}
