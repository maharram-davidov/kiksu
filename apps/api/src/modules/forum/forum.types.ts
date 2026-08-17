/**
 * Forum response shapes.
 *
 * THE RULE FOR THIS FILE: no shape here may carry a handle, an app_user_id, or
 * anything else that identifies an author across threads. An anonymous author
 * is rendered as an ordinal plus a coarse verification tier and nothing else.
 * If a field would let a reader join two posts to the same person, it does not
 * belong in this file. Enforced by tests in test/forum.integration.spec.ts.
 */

/** How an author is shown. `alias` is the default and the only case the design shows. */
export interface AliasAuthorDto {
  /** Per-thread ordinal. "ANONİM 4". Never reused across threads. */
  alias_number: number;
  /** Coarse badge only: the design's ✓ (email) vs KART (card). */
  tier: "unverified" | "email" | "card";
  /** True for the thread author — renders the MÜƏLLİF badge. */
  is_op: boolean;
}

export interface BoardDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: string;
  follower_count: number;
  post_count: number;
  /** Null for national boards. */
  university_code: string | null;
}

export interface PostSummaryDto {
  id: string;
  title: string;
  excerpt: string | null;
  kind: string;
  author: AliasAuthorDto;
  /** Opt-in campus badge, national boards only. Null unless the author ticked it. */
  author_university_code: string | null;
  score: number;
  comment_count: number;
  save_count: number;
  created_at: string;
}

export interface PostPageDto {
  items: PostSummaryDto[];
  next_cursor: string | null;
}

export interface CommentDto {
  id: string;
  author: AliasAuthorDto;
  body: string;
  score: number;
  depth: number;
  created_at: string;
}

export interface PostDetailDto {
  id: string;
  board: { slug: string; name: string };
  title: string;
  body: string | null;
  kind: string;
  author: AliasAuthorDto;
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
  comments: CommentDto[];
  /**
   * The ordinal this caller WOULD receive if they commented — the design's
   * "ANONİM 5 KİMİ YAZ". Reserved, not consumed; see identity spec §3.3.
   */
  your_next_alias: number;
}
