import { Injectable } from "@nestjs/common";
import type postgres from "postgres";
import { SqlProvider } from "../../common/db/sql.provider";
import { CursorService } from "../../common/pagination/cursor.service";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import type {
  CourseHitDto, InstructorHitDto, ListingHitDto, ListingSort, PostHitDto, PostScope,
  SearchPageDto, VacancyHitDto, VacancySort,
} from "./search.types";

/**
 * Maps the token's tier vocabulary onto the `verification_tier` enum the
 * `board.min_tier_to_read` gate is expressed in. Deliberately identical to
 * `forum.service.ts`'s `callerReadTier` — search reads the same boards through
 * the same gate, and two subtly different translations of "may this account
 * read this board" is exactly how a card-gated board leaks through the surface
 * nobody thought to check.
 */
function callerReadTier(tier: KiksuRequestContext["tier"]): "unverified" | "email_verified" | "card_verified" {
  switch (tier) {
    case "card":
      return "card_verified";
    case "email":
    case "graduate":
      return "email_verified";
    default:
      return "unverified";
  }
}

/** The DB tier enum rendered as the coarse badge the client shows. */
function tierBadge(t: string): "unverified" | "email" | "card" {
  return t === "card_verified" ? "card" : t === "email_verified" ? "email" : "unverified";
}

/**
 * Global search across the five public corpora (HM-03 – HM-06).
 *
 * ## The two things that decide whether this works at all
 *
 * **Folding.** Every stored `search_vector` is built over `util.fold_text()`
 * output, which maps `e->e g->g i->i o->o s->s u->u c->c` and strips the
 * combining dot above that `lower('I')` produces. The query side MUST go
 * through `util.tsq()`, which applies the identical fold. Folding one side and
 * not the other is not a degradation — it silently returns nothing for the most
 * common spelling of half the catalogue, because Azerbaijani students type `e`
 * for `e` constantly and every stored token has already been folded past it.
 *
 * **Per-row language.** A row's vector was built with *that row's* `lang`
 * config: `util.az` is `simple` (no Azerbaijani stemmer exists), while
 * `util.ru` and `util.en` carry real stemmers. Querying every row with one
 * config therefore misses stems on the other two. The obvious fix —
 * `util.tsq(util.locale_text(p.lang), $q)` — makes the query operand
 * row-dependent, which means the GIN index cannot serve it and every search
 * becomes a sequential scan over the corpus.
 *
 * So the predicate is written as three constant arms paired to the row's
 * language. Each arm's tsquery is a constant for the whole statement (`util.tsq`
 * is STABLE, which is sufficient for index-qual evaluation), so each is one
 * bitmap index scan, and the three are OR'd. Pairing to `lang` rather than
 * simply OR-ing three queries against every row also keeps a Russian stem from
 * matching an Azerbaijani row that only coincidentally shares a token.
 *
 * `ref.course`, `ref.instructor` and `ref.university` need only the `az` arm:
 * their vectors are generated with a hardcoded `'az'` config regardless of the
 * row's own language, so a three-arm predicate there would be three probes for
 * one possible match.
 *
 * ## What is deliberately absent
 *
 * **A people corpus.** Identity spec T11: handle search accepts exact
 * full-handle matches only, is opt-in, and is rate-limited with an equalised
 * response time. Prefix or fuzzy matching over `sakit-pervane-37` walks the
 * adjective x noun space and enumerates the user base along with each user's
 * rendered university and year. Global search does not read `app_user` as a
 * corpus at all — it appears here only as a join for the marketplace seller
 * projection, which is Layer 2 and public by product necessity.
 *
 * **`ts_headline` snippets.** The vector is built from folded text, so a
 * headline generated against it renders `Verilenler` where the row says
 * `Verilenler`. Results carry the same `left(body, 180)` excerpt the feed uses
 * until there is a fold-aware highlighter worth writing.
 *
 * **Review prose.** `public.review.search_vector` exists and is indexed, but
 * review bodies sit behind the contribution wall. Returning a matched snippet
 * to a student who has not written a review this term hands them exactly what
 * the wall withholds. Courses and professors are searchable; the prose is not.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: SqlProvider,
    private readonly cursors: CursorService,
  ) {}

  // ------------------------------------------------------------------
  // HM-04 — posts
  // ------------------------------------------------------------------

  /**
   * Forum post search.
   *
   * Scoping is load-bearing rather than defensive: the pool is BYPASSRLS, so
   * these four predicates are the whole of what stops a search from reading
   * another campus. `min_tier_to_read` matters more here than in the board
   * feed — without it, search becomes a way to read a card-gated board's
   * contents from outside the board that refuses to list them.
   *
   * `moderation_state in ('visible','limited')` matches the board feed exactly.
   * That is a deliberate choice, not an oversight: `limited` (shadowbanned)
   * content is currently visible in the feed, so hiding it *here* would hand a
   * shadowbanned student a reliable self-test — search for your own post, and
   * its absence tells you the sanction landed. Tightening `limited` is one
   * decision to be taken across every read path at once, not surface by
   * surface.
   */
  async searchPosts(
    user: KiksuRequestContext,
    q: string,
    scope: PostScope,
    boardSlug: string | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<SearchPageDto<PostHitDto>> {
    const { sql } = this.db;
    const fingerprint = this.cursors.fingerprintQuery("search.posts", {
      q, scope, board: boardSlug, limit, univ: user.univId, tier: callerReadTier(user.tier),
    });
    const after = this.decode(cursor, fingerprint);

    const hits = sql`
      select p.id, p.title,
             left(p.body, 180) as excerpt,
             b.slug as board_slug, b.name_az as board_name,
             bu.code as board_university_code,
             case when b.university_id is null then 'national' else 'campus' end as scope,
             p.author_alias_number, p.author_tier::text as author_tier,
             au.code as author_university_code,
             p.score, p.comment_count, p.created_at,
             ts_rank_cd(p.search_vector,
                        util.tsq(util.locale_text(p.lang), ${q}))::numeric(24,8) as sort_a,
             extract(epoch from p.created_at)::numeric(20,6) as sort_b
        from public.post p
        join public.board b on b.id = p.board_id
        left join ref.university bu on bu.id = b.university_id
        left join ref.university au on au.id = p.author_university_id
       where (
                (p.lang = 'az' and p.search_vector @@ util.tsq('az', ${q}))
             or (p.lang = 'ru' and p.search_vector @@ util.tsq('ru', ${q}))
             or (p.lang = 'en' and p.search_vector @@ util.tsq('en', ${q}))
             )
         and p.moderation_state in ('visible', 'limited')
         and p.deleted_at is null
         -- Campus scoping. A national board has no university_id; anything
         -- else must be this caller's campus.
         and (b.university_id is null or b.university_id = ${user.univId})
         -- The board's own read gate, same as the feed's.
         and b.min_tier_to_read <= ${callerReadTier(user.tier)}::public.verification_tier
         and not b.is_archived
         and (${scope}::text = 'all'
              or (${scope}::text = 'national' and b.university_id is null)
              or (${scope}::text = 'campus'   and b.university_id is not null))
         and (${boardSlug ?? null}::text is null or b.slug = ${boardSlug ?? null})
    `;

    const rows = await this.pageDesc(hits, after, limit);
    const { page, nextCursor } = this.finish(rows, limit, fingerprint);

    return {
      items: page.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        excerpt: (r.excerpt as string) ?? null,
        board: { slug: r.board_slug as string, name: r.board_name as string },
        board_university_code: (r.board_university_code as string) ?? null,
        scope: r.scope as "campus" | "national",
        author: {
          alias_number: (r.author_alias_number as number) ?? 1,
          tier: tierBadge(r.author_tier as string),
        },
        author_university_code: (r.author_university_code as string) ?? null,
        score: r.score as number,
        comment_count: r.comment_count as number,
        created_at: (r.created_at as Date).toISOString(),
      })),
      next_cursor: nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // HM-05 — courses and professors
  // ------------------------------------------------------------------

  /**
   * Course catalogue search with the rating summary inline.
   *
   * Three match paths, OR'd: the full-text vector, a folded code prefix so
   * `cs2` finds `CS 214`, and a folded substring over the title so a partial
   * word still lands. The trigram indexes on `code_folded` and the FTS index
   * cover the first two; the substring arm is the deliberate slow path that
   * makes short queries feel right on a catalogue of a few thousand rows.
   */
  async searchCourses(
    user: KiksuRequestContext,
    q: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<SearchPageDto<CourseHitDto>> {
    const { sql } = this.db;
    const fingerprint = this.cursors.fingerprintQuery("search.courses", { q, limit, univ: user.univId });
    const after = this.decode(cursor, fingerprint);

    const hits = sql`
      select c.id, c.code, c.title_az as title, c.credits,
             d.name_az as department,
             s.rating_avg,
             coalesce(s.review_count, 0)::int as review_count,
             greatest(
               ts_rank_cd(c.title_search, util.tsq('az', ${q})),
               -- A code-prefix hit outranks a body hit: someone typing "CS 214"
               -- wants that course, not every course that mentions it.
               case when util.fold_handle(c.code) like util.fold_handle(${q}) || '%'
                    then 1.0 else 0.0 end
             )::numeric(24,8) as sort_a,
             0::numeric(20,6) as sort_b
        from ref.course c
        left join ref.department d on d.id = c.department_id
        left join public.course_review_summary s on s.course_id = c.id
       where c.university_id = ${user.univId}
         and c.is_active
         and (
              c.title_search @@ util.tsq('az', ${q})
           or util.fold_handle(c.code) like util.fold_handle(${q}) || '%'
           or util.fold_text(c.title_az) like '%' || util.fold_text(${q}) || '%'
         )
    `;

    const rows = await this.pageDesc(hits, after, limit);
    const { page, nextCursor } = this.finish(rows, limit, fingerprint);

    return {
      items: page.map((r) => ({
        id: r.id as string,
        code: r.code as string,
        title: r.title as string,
        credits: r.credits === null ? null : Number(r.credits),
        department: (r.department as string) ?? null,
        rating_avg: r.rating_avg === null ? null : Number(r.rating_avg),
        review_count: r.review_count as number,
      })),
      next_cursor: nextCursor,
    };
  }

  /**
   * Instructor search.
   *
   * Instructor names are real and public — this is a professor-review product,
   * and an instructor is never an `app_user`. This endpoint has no relationship
   * to handle search and none to the k-anonymity floor. The trigram index over
   * `name_folded` is what makes `Eliyeva` find `Eliyeva`.
   */
  async searchInstructors(
    user: KiksuRequestContext,
    q: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<SearchPageDto<InstructorHitDto>> {
    const { sql } = this.db;
    const fingerprint = this.cursors.fingerprintQuery("search.instructors", { q, limit, univ: user.univId });
    const after = this.decode(cursor, fingerprint);

    const hits = sql`
      select i.id, i.full_name, i.title_prefix,
             d.name_az as department,
             s.rating_avg,
             coalesce(s.review_count, 0)::int as review_count,
             coalesce(s.course_count, 0)::int as course_count,
             greatest(
               ts_rank_cd(i.name_search, util.tsq('az', ${q})),
               extensions.similarity(i.name_folded, util.fold_text(${q}))
             )::numeric(24,8) as sort_a,
             0::numeric(20,6) as sort_b
        from ref.instructor i
        left join ref.department d on d.id = i.department_id
        left join public.instructor_review_summary s on s.instructor_id = i.id
       where i.university_id = ${user.univId}
         and i.is_active
         and (
              i.name_search @@ util.tsq('az', ${q})
           or i.name_folded like '%' || util.fold_text(${q}) || '%'
         )
    `;

    const rows = await this.pageDesc(hits, after, limit);
    const { page, nextCursor } = this.finish(rows, limit, fingerprint);

    return {
      items: page.map((r) => ({
        id: r.id as string,
        full_name: r.full_name as string,
        title_prefix: (r.title_prefix as string) ?? null,
        department: (r.department as string) ?? null,
        rating_avg: r.rating_avg === null ? null : Number(r.rating_avg),
        review_count: r.review_count as number,
        course_count: r.course_count as number,
      })),
      next_cursor: nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // HM-06 — listings and jobs
  // ------------------------------------------------------------------

  /**
   * Marketplace search. Campus-scoped, like the browse feed.
   *
   * `price_asc` is the one ascending sort in the whole search surface, which is
   * why `pageAsc` exists alongside `pageDesc` rather than a direction being
   * interpolated into one query — see `pageDesc`'s note on why that is written
   * out rather than composed.
   */
  async searchListings(
    user: KiksuRequestContext,
    q: string,
    sort: ListingSort,
    limit: number,
    cursor: string | undefined,
  ): Promise<SearchPageDto<ListingHitDto>> {
    const { sql } = this.db;
    const fingerprint = this.cursors.fingerprintQuery("search.listings", {
      q, sort, limit, univ: user.univId,
    });
    const after = this.decode(cursor, fingerprint);

    // The sort key pair, normalised to two numerics so one keyset comparison
    // serves every sort. `sort_b` breaks rank ties by recency; for the explicit
    // price and date sorts it is the same column repeated, which is harmless
    // and keeps the comparison total.
    const sortA = sort === "price_asc" || sort === "price_desc"
      ? sql`l.price_minor::numeric(24,8)`
      : sort === "newest"
        ? sql`extract(epoch from l.published_at)::numeric(24,8)`
        : sql`ts_rank_cd(l.search_vector, util.tsq(util.locale_text(l.lang), ${q}))::numeric(24,8)`;

    const hits = sql`
      select l.id, l.title,
             left(l.description, 180) as excerpt,
             cat.key as category_key, cat.name_az as category_name,
             l.price_minor, l.currency, l.is_negotiable, l.condition::text as condition,
             crs.code as related_course_code, l.published_at,
             s.handle, s.avatar_id, s.contributor_level,
             ${sortA} as sort_a,
             extract(epoch from l.published_at)::numeric(20,6) as sort_b
        from public.listing l
        join ref.marketplace_category cat on cat.id = l.category_id
        left join ref.course crs on crs.id = l.related_course_id
        left join public.app_user s on s.id = l.seller_id
       where (
                (l.lang = 'az' and l.search_vector @@ util.tsq('az', ${q}))
             or (l.lang = 'ru' and l.search_vector @@ util.tsq('ru', ${q}))
             or (l.lang = 'en' and l.search_vector @@ util.tsq('en', ${q}))
             )
         and l.university_id = ${user.univId}
         and l.status in ('active', 'reserved')
         and l.moderation_state in ('visible', 'limited')
         and l.deleted_at is null
    `;

    const rows = sort === "price_asc"
      ? await this.pageAsc(hits, after, limit)
      : await this.pageDesc(hits, after, limit);
    const { page, nextCursor } = this.finish(rows, limit, fingerprint);

    return {
      items: page.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        excerpt: (r.excerpt as string) ?? null,
        category_key: r.category_key as string,
        category_name: r.category_name as string,
        price_minor: r.price_minor as number,
        currency: r.currency as string,
        is_negotiable: r.is_negotiable as boolean,
        condition: r.condition as string,
        related_course_code: (r.related_course_code as string) ?? null,
        seller: r.handle
          ? {
              handle: r.handle as string,
              avatar_id: (r.avatar_id as number) ?? 0,
              contributor_level: r.contributor_level === null ? null : Number(r.contributor_level),
            }
          : null,
        published_at: (r.published_at as Date).toISOString(),
      })),
      next_cursor: nextCursor,
    };
  }

  /**
   * Vacancy search.
   *
   * Not campus-scoped the way listings are: a vacancy is national unless the
   * employer targeted specific campuses, which is what `target_university_ids`
   * expresses. The `external_url is not null` filter matches the careers feed —
   * since Kiksu hands off rather than taking applications, a vacancy with no
   * link is something nobody can act on.
   */
  async searchVacancies(
    user: KiksuRequestContext,
    q: string,
    sort: VacancySort,
    limit: number,
    cursor: string | undefined,
  ): Promise<SearchPageDto<VacancyHitDto>> {
    const { sql } = this.db;
    const fingerprint = this.cursors.fingerprintQuery("search.vacancies", {
      q, sort, limit, univ: user.univId,
    });
    const after = this.decode(cursor, fingerprint);

    // `deadline` sorts soonest-first, so it is the ascending branch. Nulls are
    // coalesced to `infinity` rather than relying on NULLS LAST: a keyset
    // comparison against a NULL is never true, so a null deadline would end the
    // page early and silently drop every deadline-less vacancy after it.
    const sortA = sort === "deadline"
      ? sql`extract(epoch from coalesce(v.apply_deadline, '9999-12-31'::date))::numeric(24,8)`
      : sort === "newest"
        ? sql`extract(epoch from v.posted_at)::numeric(24,8)`
        : sql`ts_rank_cd(v.search_vector, util.tsq(util.locale_text(v.lang), ${q}))::numeric(24,8)`;

    const hits = sql`
      select v.id, v.title,
             left(v.description, 180) as excerpt,
             v.kind::text as kind, v.work_mode::text as work_mode, v.city,
             v.is_paid, v.stipend_minor, v.currency, v.apply_deadline,
             case when v.apply_deadline is null then null
                  else greatest(0, (v.apply_deadline::date - current_date))::int end as days_left,
             e.slug as employer_slug, e.name as employer_name,
             e.logo_initials, e.brand_color,
             ${sortA} as sort_a,
             extract(epoch from v.posted_at)::numeric(20,6) as sort_b
        from public.vacancy v
        join public.employer e on e.id = v.employer_id
       where (
                (v.lang = 'az' and v.search_vector @@ util.tsq('az', ${q}))
             or (v.lang = 'ru' and v.search_vector @@ util.tsq('ru', ${q}))
             or (v.lang = 'en' and v.search_vector @@ util.tsq('en', ${q}))
             )
         and v.status = 'active'
         and e.is_active
         and (v.apply_deadline is null or v.apply_deadline >= now())
         and (v.target_university_ids is null
              or cardinality(v.target_university_ids) = 0
              or ${user.univId} = any (v.target_university_ids))
         and v.external_url is not null
    `;

    const rows = sort === "deadline"
      ? await this.pageAsc(hits, after, limit)
      : await this.pageDesc(hits, after, limit);
    const { page, nextCursor } = this.finish(rows, limit, fingerprint);

    return {
      items: page.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        excerpt: (r.excerpt as string) ?? null,
        kind: r.kind as string,
        work_mode: r.work_mode as string,
        city: (r.city as string) ?? null,
        is_paid: r.is_paid as boolean,
        stipend_minor: (r.stipend_minor as number) ?? null,
        currency: r.currency as string,
        apply_deadline: r.apply_deadline ? String(r.apply_deadline) : null,
        days_left: (r.days_left as number) ?? null,
        employer: {
          slug: r.employer_slug as string,
          name: r.employer_name as string,
          logo_initials: (r.logo_initials as string) ?? null,
          brand_color: (r.brand_color as string) ?? null,
        },
      })),
      next_cursor: nextCursor,
    };
  }

  // ------------------------------------------------------------------
  // Keyset pagination over a `hits` fragment
  // ------------------------------------------------------------------

  /**
   * Every corpus projects its sort into the same `(sort_a, sort_b, id)` triple,
   * so one comparison serves relevance, price and date alike. `sort_a` and
   * `sort_b` are numerics rather than the underlying columns because a cursor
   * carries strings: `ts_rank_cd` returns float4, whose text round-trip is not
   * exact, and a keyset that does not round-trip exactly either repeats a row
   * or skips one.
   *
   * The four combinations (asc/desc x first-page/continuation) are written out
   * rather than composed from a direction flag. `forum.service.ts` records why:
   * conditionally composing a WHERE clause through the driver proved subtle
   * enough to silently return zero rows, and a search that quietly paginates
   * into nothing is a bad thing to be clever about.
   */
  private async pageDesc(
    hits: postgres.PendingQuery<postgres.Row[]>,
    after: [string, string, string] | null,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const { sql } = this.db;
    return after
      ? await sql<Array<Record<string, unknown>>>`
          with hits as (${hits})
          select * from hits
           where (sort_a, sort_b, id)
                 < (${after[0]}::numeric(24,8), ${after[1]}::numeric(20,6), ${after[2]}::uuid)
           order by sort_a desc, sort_b desc, id desc
           limit ${limit + 1}
        `
      : await sql<Array<Record<string, unknown>>>`
          with hits as (${hits})
          select * from hits
           order by sort_a desc, sort_b desc, id desc
           limit ${limit + 1}
        `;
  }

  private async pageAsc(
    hits: postgres.PendingQuery<postgres.Row[]>,
    after: [string, string, string] | null,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const { sql } = this.db;
    return after
      ? await sql<Array<Record<string, unknown>>>`
          with hits as (${hits})
          select * from hits
           where (sort_a, sort_b, id)
                 > (${after[0]}::numeric(24,8), ${after[1]}::numeric(20,6), ${after[2]}::uuid)
           order by sort_a asc, sort_b asc, id asc
           limit ${limit + 1}
        `
      : await sql<Array<Record<string, unknown>>>`
          with hits as (${hits})
          select * from hits
           order by sort_a asc, sort_b asc, id asc
           limit ${limit + 1}
        `;
  }

  /** Verifies a presented cursor against this exact query and unpacks its keyset. */
  private decode(cursor: string | undefined, fingerprint: string): [string, string, string] | null {
    if (!cursor) return null;
    const payload = this.cursors.verify(cursor, fingerprint);
    const [a, b, id] = payload.k;
    // A cursor that verifies but carries the wrong arity is a cursor from an
    // older shape of this endpoint. Same undifferentiated failure as a forged
    // one, for the same reason (§3.4).
    if (a === undefined || b === undefined || id === undefined) return null;
    return [a, b, id];
  }

  /** Trims the lookahead row and mints the next cursor from the last row kept. */
  private finish(
    rows: Array<Record<string, unknown>>,
    limit: number,
    fingerprint: string,
  ): { page: Array<Record<string, unknown>>; nextCursor: string | null } {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      page,
      nextCursor: hasMore && last
        ? this.cursors.sign({
            queryFingerprint: fingerprint,
            keyset: [String(last.sort_a), String(last.sort_b), String(last.id)],
            direction: "desc",
          })
        : null,
    };
  }
}
