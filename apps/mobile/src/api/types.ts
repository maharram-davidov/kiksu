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
