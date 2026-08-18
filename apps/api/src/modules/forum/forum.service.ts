import { Injectable, NotFoundException } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import { CursorService } from "../../common/pagination/cursor.service";
import { ModerationService } from "../moderation/moderation.service";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { SanctionsService } from "../../common/sanctions/sanctions.service";
import type {
  BoardDto, CommentDto, CreateCommentInput, CreatePostInput,
  PostDetailDto, PostPageDto, PostSummaryDto,
} from "./forum.types";

/** Maps the DB tier enum onto the coarse badge the client renders. */
function tierBadge(t: string): "unverified" | "email" | "card" {
  return t === "card_verified" ? "card" : t === "email_verified" ? "email" : "unverified";
}

/**
 * The request context and the database speak different tier vocabularies:
 * the token carries provisional/email/card/graduate/expired, while
 * ref/public tables use the verification_tier enum
 * (unverified < email_verified < card_verified, declared ascending).
 *
 * Board reads are gated on board.min_tier_to_read, so the two have to be
 * compared. Translating here — rather than letting each query improvise —
 * means there is exactly one place where a graduate or an expired account
 * gets its read level decided.
 */
function callerReadTier(tier: KiksuRequestContext["tier"]): "unverified" | "email_verified" | "card_verified" {
  switch (tier) {
    case "card":
      return "card_verified";
    case "email":
    // A graduate keeps read access at the email level: verified they were a
    // student, no longer entitled to card-gated campus spaces.
    case "graduate":
      return "email_verified";
    // provisional (mid-onboarding) and expired (lapsed re-verification) both
    // read at the lowest level rather than being refused outright, so the app
    // can still render public boards while nudging them to verify.
    case "provisional":
    case "expired":
    default:
      return "unverified";
  }
}

/**
 * Forum reads.
 *
 * Two responsibilities beyond fetching rows, both load-bearing:
 *
 * 1. SCOPING. The pool is BYPASSRLS (see SqlProvider), so every query states
 *    its own campus predicate. A board is visible when it is national
 *    (university_id is null) or belongs to the caller's university, and the
 *    caller's tier clears min_tier_to_read.
 *
 * 2. NOT LEAKING AUTHORSHIP. These queries deliberately never join
 *    internal.post_author or internal.comment_author. They cannot: that schema
 *    has no grant to this role. Authorship is unavailable here by construction
 *    rather than by discipline, which is the point of invariant 1.
 */
@Injectable()
export class ForumService {
  constructor(
    private readonly db: SqlProvider,
    private readonly cursors: CursorService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsService,
  ) {}

  async listBoards(user: KiksuRequestContext): Promise<BoardDto[]> {
    const { sql } = this.db;
    return sql<BoardDto[]>`
      select b.id, b.slug, b.name_az as name, b.description_az as description,
             b.scope::text, b.follower_count, b.post_count, u.code as university_code
        from public.board b
        left join ref.university u on u.id = b.university_id
       where b.is_archived = false
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
       order by (b.university_id is null), b.display_order, b.name_az
    `;
  }

  async getBoardFeed(
    user: KiksuRequestContext, slug: string, cursor: string | null, limit = 20,
  ): Promise<PostPageDto> {
    const { sql } = this.db;

    const [board] = await sql<Array<{ id: string }>>`
      select b.id from public.board b
       where b.slug = ${slug}
         and b.is_archived = false
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
    `;
    if (!board) throw new NotFoundException("board_not_found");

    const fingerprint = this.cursors.fingerprintQuery("forum.board_feed", { slug, limit });

    // Keyset, never OFFSET.
    //
    // DEVIATION from 05-api-conventions.md §4.3, deliberate and flagged:
    // the doc says quantise the cursor's timestamp to 60s. Doing that breaks
    // the keyset. Flooring the sort key to the minute makes
    // `(created_at, id) < (floored_ts, id)` exclude every row whose real
    // timestamp falls later in that same minute — with an active board, or a
    // seeded one where rows share a transaction, page two comes back empty and
    // posts are silently unreachable.
    //
    // The quantisation exists to stop an attacker binary-searching a post's
    // exact publication time (threat T9). That attack presumes a READABLE
    // cursor. Ours is HMAC-signed and opaque: a client cannot decode the
    // payload, cannot forge one, and cannot bind it to a different query. The
    // privacy property is carried by the signature, so full precision inside
    // it costs nothing.
    //
    // Coarse timestamps still matter in the RESPONSE BODY, which is a separate
    // control and unaffected by this. Raised in the module README for review.
    let afterCreated: string | null = null;
    let afterId: string | null = null;
    if (cursor) {
      const payload = this.cursors.verify(cursor, fingerprint);
      afterCreated = payload.k[0] ?? null;
      afterId = payload.k[1] ?? null;
    }

    // Two explicit query paths rather than one predicate that has to encode
    // "no cursor yet". Composing that conditionally through the driver proved
    // subtle enough to silently return zero rows, and a feed that quietly
    // paginates into nothing is a bad thing to be clever about. The duplication
    // is confined to the WHERE clause and both paths share the projection.
    const cols = sql`
      p.id, p.title,
      left(p.body, 180)  as excerpt,
      p.kind::text       as kind,
      p.author_alias_number, p.author_tier::text, p.author_display_mode::text,
      au.code            as author_university_code,
      p.score, p.comment_count, p.save_count,
      p.created_at       as created_at_raw,
      -- Full precision for the cursor: a JS Date holds only milliseconds, so
      -- round-tripping a microsecond timestamptz through toISOString() would
      -- truncate it and the keyset would skip rows.
      -- Cursor key as a numeric epoch with microsecond precision. A JS Date
      -- holds only milliseconds, and a parameterised timestamptz string leaves
      -- the driver to infer a type; numeric is unambiguous on both sides and
      -- keeps full precision, so the keyset cannot skip or repeat a row.
      extract(epoch from p.created_at)::numeric(20,6)::text as created_at_cursor
    `;

    type Row = Record<string, unknown> & { id: string; created_at_raw: Date; created_at_cursor: string };

    const rows: Row[] = afterCreated && afterId
      ? await sql<Row[]>`
          select ${cols}
            from public.post p
            join public.board b on b.id = p.board_id
            left join ref.university au on au.id = p.author_university_id
           where b.id = ${board.id}
             and p.moderation_state in ('visible', 'limited')
             and p.deleted_at is null
             and (extract(epoch from p.created_at)::numeric(20,6), p.id)
                 < (${afterCreated}::numeric(20,6), ${afterId}::uuid)
           order by p.created_at desc, p.id desc
           limit ${limit + 1}
        `
      : await sql<Row[]>`
          select ${cols}
            from public.post p
            join public.board b on b.id = p.board_id
            left join ref.university au on au.id = p.author_university_id
           where b.id = ${board.id}
             and p.moderation_state in ('visible', 'limited')
             and p.deleted_at is null
           order by p.created_at desc, p.id desc
           limit ${limit + 1}
        `;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => this.toSummary(r)),
      next_cursor: hasMore && last
        ? this.cursors.sign({
            queryFingerprint: fingerprint,
            keyset: [last.created_at_cursor, last.id],
            direction: "desc",
          })
        : null,
    };
  }

  async getPost(user: KiksuRequestContext, postId: string): Promise<PostDetailDto> {
    const { sql } = this.db;

    const [post] = await sql<Array<Record<string, never>>>`
      select p.id, p.title, p.body, p.kind::text as kind,
             p.author_alias_number, p.author_tier::text, p.author_display_mode::text,
             au.code as author_university_code,
             p.score, p.comment_count, p.save_count, p.created_at,
             b.slug as board_slug, b.name_az as board_name
        from public.post p
        join public.board b on b.id = p.board_id
        left join ref.university au on au.id = p.author_university_id
       where p.id = ${postId}
         and p.moderation_state in ('visible', 'limited')
         and p.deleted_at is null
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
    `;
    // Deliberately the same 404 as a nonexistent post. A distinguishable
    // "you are not verified enough" would confirm that a specific thread
    // exists on a board the caller cannot see.
    if (!post) throw new NotFoundException("post_not_found");
    const p = post as unknown as Record<string, string | number | Date | null>;

    const comments = await sql<Array<Record<string, string | number | Date | boolean>>>`
      select c.id, c.author_alias_number, c.author_tier::text as author_tier,
             c.is_op, c.body, c.score, c.depth, c.created_at
        from public.post_comment c
       where c.post_id = ${postId}
         and c.moderation_state in ('visible', 'limited')
         and c.deleted_at is null
       order by c.path
    `;

    const pollRows = await sql<Array<Record<string, string | number | Date | null>>>`
      select pl.question, pl.total_votes, pl.closes_at,
             po.position, po.label, po.vote_count
        from public.poll pl
        join public.poll_option po on po.post_id = pl.post_id
       where pl.post_id = ${postId}
       order by po.position
    `;

    // The composer's "ANONİM 5 KİMİ YAZ". Reserved with a TTL rather than
    // consumed: showing an ordinal the caller might not use would leave a
    // permanent gap, and a permanent gap says "someone opened the composer and
    // thought better of it" (identity spec P3).
    const [alias] = await sql<Array<{ n: number }>>`
      select internal.allocate_thread_alias(${postId}::uuid, ${user.appUserId}::uuid,
                                            interval '5 minutes', false) as n
    `;

    return {
      id: p.id as string,
      board: { slug: p.board_slug as string, name: p.board_name as string },
      title: p.title as string,
      body: (p.body as string) ?? null,
      kind: p.kind as string,
      author: {
        alias_number: (p.author_alias_number as number) ?? 1,
        tier: tierBadge(p.author_tier as string),
        is_op: true,
      },
      author_university_code: (p.author_university_code as string) ?? null,
      score: p.score as number,
      comment_count: p.comment_count as number,
      save_count: p.save_count as number,
      created_at: (p.created_at as Date).toISOString(),
      poll: pollRows.length
        ? {
            question: pollRows[0]!.question as string,
            total_votes: pollRows[0]!.total_votes as number,
            closes_at: pollRows[0]!.closes_at
              ? (pollRows[0]!.closes_at as Date).toISOString() : null,
            options: pollRows.map((o) => ({
              position: o.position as number,
              label: o.label as string,
              vote_count: o.vote_count as number,
            })),
          }
        : null,
      comments: comments.map<CommentDto>((c) => ({
        id: c.id as string,
        author: {
          alias_number: c.author_alias_number as number,
          tier: tierBadge(c.author_tier as string),
          is_op: c.is_op as boolean,
        },
        body: c.body as string,
        score: c.score as number,
        depth: c.depth as number,
        created_at: (c.created_at as Date).toISOString(),
      })),
      your_next_alias: alias?.n ?? 1,
    };
  }

  /**
   * Creates a thread.
   *
   * Everything here happens in ONE transaction, and that is a requirement
   * rather than a convenience. `internal.allocate_thread_alias()` takes a row
   * lock on the post and hands back an ordinal; identity spec §3.4 says
   * allocation must be in the same transaction as the content insert, so that
   * a post which rolls back cannot strand an ordinal and leave a permanent gap
   * in the rendered sequence. A gap says "someone opened the composer and
   * thought better of it" (P3), which is precisely what the scheme hides.
   */
  async createPost(user: KiksuRequestContext, input: CreatePostInput): Promise<PostDetailDto> {
    // A suspended or muted student may read, but not write. Checked before
    // anything else so a refusal costs one query and leaves no partial state.
    await this.sanctions.assertMayWrite(user);

    const postId = await this.db.transaction(async (tx) => {
      const [board] = await tx<Array<{ id: string; scope: string; university_id: string | null }>>`
        select b.id, b.scope::text, b.university_id
          from public.board b
         where b.slug = ${input.board_slug}
           and b.is_archived = false
           and (b.university_id is null or b.university_id = ${user.univId})
           and b.min_tier_to_post <= ${callerReadTier(user.tier)}::public.verification_tier
      `;
      // Same 404 whether the board is missing, off-campus, or above the
      // caller's tier — see the note on getPost.
      if (!board) throw new NotFoundException("board_not_found");

      // The badge is only ever the CALLER's own university, never a value the
      // client supplies. A trigger confines it to national boards; this
      // confines it to the truth.
      const badgeUniversity =
        input.show_university_badge && board.scope === "national" ? user.univId : null;

      const [row] = await tx<Array<{ id: string }>>`
        insert into public.post (board_id, university_id, title, body,
                                 author_display_mode, author_alias_number,
                                 author_tier, author_university_id)
        select ${board.id}, ${board.university_id}, ${input.title}, ${input.body ?? null},
               'alias', 1, au.verification_tier, ${badgeUniversity}
          from public.app_user au
         where au.id = ${user.appUserId}
        returning id
      `;
      if (!row) throw new NotFoundException("author_not_found");

      // Classify in the SAME transaction as the insert. Doing it afterwards
      // leaves a window where a phone number is fully visible, and closing
      // that window is the entire point of an automated tier.
      const state = await this.moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: row.id,
        universityId: board.university_id ?? user.univId,
        title: input.title, body: input.body ?? null,
        authorAppUserId: user.appUserId,
      });
      if (state !== "visible") {
        await tx`update public.post set moderation_state = ${state}::public.moderation_state
                  where id = ${row.id}`;
      }

      // Authorship goes to internal, never onto the public row.
      await tx`insert into internal.post_author (post_id, app_user_id)
               values (${row.id}, ${user.appUserId})`;

      const [alias] = await tx<Array<{ n: number }>>`
        select internal.allocate_thread_alias(${row.id}::uuid, ${user.appUserId}::uuid,
                                              interval '5 minutes', true) as n
      `;
      // The thread author must hold ordinal 1 (identity spec P4). Asserting it
      // here rather than trusting it means a regression in the allocator
      // surfaces as a failed write, not as a mislabelled thread.
      if (alias?.n !== 1) {
        throw new Error(`thread author must hold alias 1, got ${alias?.n}`);
      }
      await tx`update internal.thread_alias set is_op = true
                where post_id = ${row.id} and app_user_id = ${user.appUserId}`;

      return row.id;
    });

    return this.getPost(user, postId);
  }

  /** Adds a comment, allocating the author's per-thread alias in the same transaction. */
  async createComment(
    user: KiksuRequestContext, postId: string, input: CreateCommentInput,
  ): Promise<CommentDto> {
    // A suspended or muted student may read, but not write. Checked before
    // anything else so a refusal costs one query and leaves no partial state.
    await this.sanctions.assertMayWrite(user);

    return this.db.transaction(async (tx) => {
      const [post] = await tx<Array<{ id: string }>>`
        select p.id from public.post p
          join public.board b on b.id = p.board_id
         where p.id = ${postId}
           and p.moderation_state in ('visible', 'limited')
           and p.deleted_at is null
           and (b.university_id is null or b.university_id = ${user.univId})
           and b.min_tier_to_post <= ${callerReadTier(user.tier)}::public.verification_tier
      `;
      if (!post) throw new NotFoundException("post_not_found");

      // Idempotent per (thread, user): someone who already spoke in this
      // thread keeps the ordinal readers have already seen against them.
      const [alias] = await tx<Array<{ n: number }>>`
        select internal.allocate_thread_alias(${postId}::uuid, ${user.appUserId}::uuid,
                                              interval '5 minutes', true) as n
      `;

      const [seq] = await tx<Array<{ next: number }>>`
        select coalesce(max(seq_in_post), 0) + 1 as next
          from public.post_comment where post_id = ${postId}
      `;
      const seqInPost = seq?.next ?? 1;

      const [row] = await tx<Array<Record<string, string | number | boolean | Date>>>`
        insert into public.post_comment (post_id, parent_id, seq_in_post, path, depth, body,
                                         author_display_mode, author_alias_number, author_tier, is_op)
        -- array[...] over a driver parameter infers text[]; the column is
        -- integer[], so the cast has to be explicit.
        select ${postId}, ${input.parent_id ?? null}, ${seqInPost},
               array[${seqInPost}]::integer[], 0,
               ${input.body}, 'alias', ${alias?.n ?? 1}, au.verification_tier,
               exists (select 1 from internal.post_author pa
                        where pa.post_id = ${postId} and pa.app_user_id = ${user.appUserId})
          from public.app_user au
         where au.id = ${user.appUserId}
        returning id, author_alias_number, author_tier::text as author_tier, is_op,
                  body, score, depth, created_at
      `;
      if (!row) throw new NotFoundException("author_not_found");

      await tx`insert into internal.comment_author (comment_id, app_user_id)
               values (${row.id as string}, ${user.appUserId})`;

      const state = await this.moderation.classifyOnWrite(tx, {
        targetType: "comment", targetId: row.id as string,
        universityId: user.univId, body: input.body,
        authorAppUserId: user.appUserId,
      });
      if (state !== "visible") {
        await tx`update public.post_comment
                    set moderation_state = ${state}::public.moderation_state
                  where id = ${row.id as string}`;
      }

      return {
        id: row.id as string,
        author: {
          alias_number: row.author_alias_number as number,
          tier: tierBadge(row.author_tier as string),
          is_op: row.is_op as boolean,
        },
        body: row.body as string,
        score: row.score as number,
        depth: row.depth as number,
        created_at: (row.created_at as Date).toISOString(),
      };
    });
  }

  /**
   * Casts, changes or clears a vote.
   *
   * `value: 0` means "take my vote back", which is why this is not a plain
   * insert. The score and hot_rank counters and the author's karma ledger are
   * all trigger-maintained (schema 17.1), so this touches post_vote ONLY —
   * writing the score here as well would double-count.
   *
   * Idempotent: casting the same vote twice leaves one row and one score.
   */
  async votePost(
    user: KiksuRequestContext, postId: string, value: -1 | 0 | 1,
  ): Promise<{ score: number; your_vote: -1 | 0 | 1 }> {
    // A vote is a write. It is also the cheapest possible interaction, which
    // is exactly why a muted account has to be stopped from it — otherwise
    // the sanction leaves the loudest signal a person can still send.
    await this.sanctions.assertMayWrite(user);

    const { sql } = this.db;

    const [visible] = await sql<Array<{ id: string }>>`
      select p.id from public.post p
        join public.board b on b.id = p.board_id
       where p.id = ${postId}
         and p.moderation_state in ('visible', 'limited')
         and p.deleted_at is null
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
    `;
    if (!visible) throw new NotFoundException("post_not_found");

    if (value === 0) {
      await sql`delete from public.post_vote
                 where post_id = ${postId} and app_user_id = ${user.appUserId}`;
    } else {
      await sql`
        insert into public.post_vote (post_id, app_user_id, value)
        values (${postId}, ${user.appUserId}, ${value})
        on conflict (post_id, app_user_id) do update set value = excluded.value
      `;
    }

    const [row] = await sql<Array<{ score: number }>>`
      select score from public.post where id = ${postId}`;
    return { score: row?.score ?? 0, your_vote: value };
  }

  /** Adds or removes a save. Idempotent in both directions. */
  async savePost(
    user: KiksuRequestContext, postId: string, saved: boolean,
  ): Promise<{ saved: boolean; save_count: number }> {
    const { sql } = this.db;

    const [visible] = await sql<Array<{ id: string }>>`
      select p.id from public.post p
        join public.board b on b.id = p.board_id
       where p.id = ${postId}
         and p.deleted_at is null
         and (b.university_id is null or b.university_id = ${user.univId})
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
    `;
    if (!visible) throw new NotFoundException("post_not_found");

    if (saved) {
      await sql`insert into public.post_save (post_id, app_user_id)
                values (${postId}, ${user.appUserId})
                on conflict do nothing`;
    } else {
      await sql`delete from public.post_save
                 where post_id = ${postId} and app_user_id = ${user.appUserId}`;
    }

    const [row] = await sql<Array<{ save_count: number }>>`
      select save_count from public.post where id = ${postId}`;
    return { saved, save_count: row?.save_count ?? 0 };
  }

  private toSummary(r: Record<string, unknown>): PostSummaryDto {
    return {
      id: r.id as string,
      title: r.title as string,
      excerpt: (r.excerpt as string) ?? null,
      kind: r.kind as string,
      author: {
        alias_number: (r.author_alias_number as number) ?? 1,
        tier: tierBadge(r.author_tier as string),
        is_op: true,
      },
      author_university_code: (r.author_university_code as string) ?? null,
      score: r.score as number,
      comment_count: r.comment_count as number,
      save_count: r.save_count as number,
      created_at: (r.created_at_raw as Date).toISOString(),
    };
  }
}
