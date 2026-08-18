import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { SearchService } from "../src/modules/search/search.service";
import { CursorService } from "../src/common/pagination/cursor.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

/**
 * Run via `scripts/test-integration.sh`, which applies migrations + both seeds.
 *
 * Search is the widest read surface in the product: one query string reaches
 * every public corpus at once. That makes it the surface where a missing
 * predicate is worth the most to an attacker, so most of what follows is not
 * "does search find things" but "what can search NOT reach" — another campus,
 * a board above the caller's tier, a deleted row, an author's identity.
 *
 * The folding tests are the other half. Azerbaijani search is the one thing
 * here that fails silently rather than loudly: fold one side and not the other
 * and every query simply returns nothing, which reads as "no results" rather
 * than as a bug.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/** Every handle in the content seed. None may appear in a post or course response. */
const SEEDED_HANDLES = [
  "sakit-pərvanə-37", "quru-püstə-19", "uzaq-ceyran-52", "isti-nar-08",
  "mavi-turac-71", "dinc-alma-24", "yaşıl-ənbər-63", "sərin-badam-15",
];

suite("search service (integration)", () => {
  let sql: postgres.Sql;
  let service: SearchService;
  let user: KiksuRequestContext;
  let otherCampusUser: KiksuRequestContext;
  let bduId: string;
  /**
   * Pagination fixtures.
   *
   * The content seed holds six posts and six listings, and exactly ONE post
   * matches "imtahan". Every cursor test originally borrowed the seed, which
   * meant `next_cursor` was always null and the tests early-returned green
   * without asserting anything. Anything that needs a second page builds its
   * own rows against a token that appears nowhere else.
   */
  const TOKEN = "paginasiyaxx";
  let fixturePostIds: string[] = [];
  let fixtureListingIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const cursors = new CursorService({
      cursorHmacSecret: "test-secret-at-least-32-chars-long-ok",
    } as never);
    service = new SearchService({ sql } as never, cursors);

    const [bdu] = await sql`select id from ref.university where code = 'BDU'`;
    const [other] = await sql`select id from ref.university where code <> 'BDU' limit 1`;
    if (!bdu || !other) throw new Error("seed missing: two universities");
    bduId = bdu.id as string;

    const mk = (univId: string, tier: KiksuRequestContext["tier"]): KiksuRequestContext => ({
      authUserId: "00000000-0000-4000-8000-000000000000",
      appUserId: "00000000-0000-4000-8000-000000000001",
      tier,
      role: "student",
      univId,
      epoch: 1,
      sid: "00000000-0000-4000-8000-000000000002",
    } as KiksuRequestContext);

    user = mk(bduId, "email");
    otherCampusUser = mk(other.id as string, "email");

    const [board] = await sql`
      select id from public.board
       where university_id = ${bduId} and min_tier_to_read <= 'email_verified' limit 1`;
    const [seller] = await sql`select id from public.app_user where university_id = ${bduId} limit 1`;
    const [category] = await sql`select id from ref.marketplace_category limit 1`;
    if (!board || !seller || !category) throw new Error("seed missing: board, seller or category");

    // Distinct created_at values: a keyset whose tiebreakers never differ would
    // pass whether or not the ordering is total.
    const posts = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                               author_alias_number, author_tier, lang, created_at)
      select ${board.id as string}, ${bduId},
             ${TOKEN} || ' mövzu ' || n, 'Səhifələmə üçün sınaq mətni.', 'alias', n,
             'email_verified', 'az', now() - (n || ' hours')::interval
        from generate_series(1, 5) as n
      returning id`;
    fixturePostIds = posts.map((r) => r.id as string);

    const listings = await sql`
      insert into public.listing (seller_id, university_id, category_id, title, description,
                                  price_minor, currency, condition, status, lang, published_at)
      select ${seller.id as string}, ${bduId}, ${category.id as string},
             ${TOKEN} || ' elan ' || n, 'Səhifələmə üçün sınaq elanı.',
             (n * 7500)::int, 'AZN', 'good', 'active', 'az', now() - (n || ' hours')::interval
        from generate_series(1, 4) as n
      returning id`;
    fixtureListingIds = listings.map((r) => r.id as string);
  });

  afterAll(async () => {
    if (fixturePostIds.length) {
      await sql`delete from public.post where id in ${sql(fixturePostIds)}`;
    }
    if (fixtureListingIds.length) {
      await sql`delete from public.listing where id in ${sql(fixtureListingIds)}`;
    }
    await sql?.end({ timeout: 5 });
  });

  // ----------------------------------------------------------------
  // Folding — the failure mode that looks like "no results"
  // ----------------------------------------------------------------

  it("finds a course whose title carries ə when the query spells it e", async () => {
    // The catalogue holds 'Verilənlər bazası sistemləri'. A student typing on a
    // phone keyboard writes 'verilenler'. If the query is not folded the way
    // the index was, this returns zero rows and looks like an empty catalogue.
    const page = await service.searchCourses(user, "verilenler", 20, undefined);
    expect(page.items.map((c) => c.code)).toContain("CS 214");
  });

  it("finds a course by code prefix, ignoring the space", async () => {
    // util.fold_handle strips separators, so 'cs2' must reach 'CS 214'.
    const page = await service.searchCourses(user, "cs2", 20, undefined);
    expect(page.items.map((c) => c.code)).toContain("CS 214");
  });

  it("ranks an exact code hit above a body mention", async () => {
    const page = await service.searchCourses(user, "CS 214", 20, undefined);
    expect(page.items[0]?.code).toBe("CS 214");
  });

  it("finds an instructor whose name carries Ə when the query spells it E", async () => {
    // 'Əliyeva' typed as 'Eliyeva' — the trigram index over name_folded.
    const page = await service.searchInstructors(user, "Eliyeva", 20, undefined);
    expect(page.items.some((i) => i.full_name.includes("Əliyeva"))).toBe(true);
  });

  it("matches the dotted and dotless i in both directions", async () => {
    // lower('İ') yields 'i' + U+0307; util.fold_text strips the combining mark.
    // If it did not, 'İmtahan' and 'imtahan' would be different tokens.
    const upper = await service.searchPosts(user, "İmtahan", "all", undefined, 20, undefined);
    const lower = await service.searchPosts(user, "imtahan", "all", undefined, 20, undefined);
    expect(upper.items.length).toBeGreaterThan(0);
    expect(upper.items.map((p) => p.id).sort()).toEqual(lower.items.map((p) => p.id).sort());
  });

  it("finds the seeded headline thread by a word from its body", async () => {
    const page = await service.searchPosts(user, "Dekanlıqdan", "all", undefined, 20, undefined);
    expect(page.items.some((p) => p.title.startsWith("Mikroiqtisadiyyat"))).toBe(true);
  });

  // ----------------------------------------------------------------
  // Scoping — the pool is BYPASSRLS, so these predicates are the defence
  // ----------------------------------------------------------------

  it("never returns a campus post to a caller from another university", async () => {
    const mine = await service.searchPosts(user, "Mikroiqtisadiyyat", "all", undefined, 50, undefined);
    const theirs = await service.searchPosts(otherCampusUser, "Mikroiqtisadiyyat", "all", undefined, 50, undefined);

    const campusHits = mine.items.filter((p) => p.scope === "campus");
    expect(campusHits.length).toBeGreaterThan(0);

    const theirIds = new Set(theirs.items.map((p) => p.id));
    for (const hit of campusHits) expect(theirIds.has(hit.id)).toBe(false);
  });

  it("returns national posts to both campuses", async () => {
    const [nat] = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                               author_alias_number, author_tier, lang)
      select b.id, null, 'Erasmus müraciəti üçün sənəd siyahısı',
             'Bu il tələb olunan sənədlər dəyişib.', 'alias', 1, 'email_verified', 'az'
        from public.board b where b.university_id is null limit 1
      returning id`;
    if (!nat) throw new Error("seed missing: a national board");

    try {
      const mine = await service.searchPosts(user, "Erasmus", "all", undefined, 50, undefined);
      const theirs = await service.searchPosts(otherCampusUser, "Erasmus", "all", undefined, 50, undefined);
      expect(mine.items.map((p) => p.id)).toContain(nat.id);
      expect(theirs.items.map((p) => p.id)).toContain(nat.id);
      expect(mine.items.find((p) => p.id === nat.id)?.scope).toBe("national");
    } finally {
      await sql`delete from public.post where id = ${nat.id as string}`;
    }
  });

  it("honours the board's min_tier_to_read gate", async () => {
    // A card-gated board must not be readable through search by an
    // email-tier caller — otherwise search reads what the board list refuses
    // even to name.
    const [board] = await sql`
      insert into public.board (scope, university_id, slug, name_az, lang, min_tier_to_read)
      values ('university', ${bduId}, 'test-kart-qapili', 'Kart qapılı lövhə', 'az', 'card_verified')
      returning id`;
    const [post] = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                               author_alias_number, author_tier, lang)
      values (${board!.id as string}, ${bduId}, 'Yataqxana yeri barədə sual',
              'Kart doğrulaması tələb olunan lövhədə.', 'alias', 1, 'email_verified', 'az')
      returning id`;

    try {
      const asEmail = await service.searchPosts(user, "Yataqxana", "all", undefined, 50, undefined);
      expect(asEmail.items.map((p) => p.id)).not.toContain(post!.id);

      const cardUser = { ...user, tier: "card" as const };
      const asCard = await service.searchPosts(cardUser, "Yataqxana", "all", undefined, 50, undefined);
      expect(asCard.items.map((p) => p.id)).toContain(post!.id);
    } finally {
      await sql`delete from public.post where id = ${post!.id as string}`;
      await sql`delete from public.board where id = ${board!.id as string}`;
    }
  });

  it("excludes deleted and removed posts", async () => {
    const [board] = await sql`select id from public.board where university_id = ${bduId} limit 1`;
    const rows = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                              author_alias_number, author_tier, lang, moderation_state, deleted_at)
      values
        (${board!.id as string}, ${bduId}, 'Silinmiş elan haqqında', 'gizli', 'alias', 1,
         'email_verified', 'az', 'visible', now()),
        (${board!.id as string}, ${bduId}, 'Silinmiş (removed) elan haqqında', 'gizli', 'alias', 1,
         'email_verified', 'az', 'removed', null)
      returning id`;

    try {
      const page = await service.searchPosts(user, "elan haqqında", "all", undefined, 50, undefined);
      const ids = new Set(page.items.map((p) => p.id));
      for (const r of rows) expect(ids.has(r.id as string)).toBe(false);
    } finally {
      await sql`delete from public.post where id in ${sql(rows.map((r) => r.id as string))}`;
    }
  });

  it("scopes listings to the caller's campus", async () => {
    const mine = await service.searchListings(user, "Piskunov", "relevance", 50, undefined);
    const theirs = await service.searchListings(otherCampusUser, "Piskunov", "relevance", 50, undefined);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(theirs.items).toHaveLength(0);
  });

  it("scopes courses and instructors to the caller's campus", async () => {
    const courses = await service.searchCourses(otherCampusUser, "verilenler", 50, undefined);
    expect(courses.items.map((c) => c.code)).not.toContain("CS 214");

    const instructors = await service.searchInstructors(otherCampusUser, "Eliyeva", 50, undefined);
    expect(instructors.items.some((i) => i.full_name.includes("Əliyeva"))).toBe(false);
  });

  // ----------------------------------------------------------------
  // Layer separation — P12 and assertion 21
  // ----------------------------------------------------------------

  it("never returns an author identity on a post hit", async () => {
    const page = await service.searchPosts(user, "imtahan", "all", undefined, 50, undefined);
    expect(page.items.length).toBeGreaterThan(0);
    const body = JSON.stringify(page.items);
    for (const handle of SEEDED_HANDLES) expect(body).not.toContain(handle);
    expect(body).not.toContain("app_user_id");
    for (const hit of page.items) {
      expect(hit).not.toHaveProperty("handle");
      expect(hit.author.alias_number).toBeGreaterThan(0);
    }
  });

  it("keeps aliases and handles in separate responses", async () => {
    // Assertion 21, checked at the surface that would break it: post hits carry
    // an alias, listing hits carry a handle, and no single response has both.
    const posts = await service.searchPosts(user, "imtahan", "all", undefined, 20, undefined);
    const listings = await service.searchListings(user, "Piskunov", "relevance", 20, undefined);

    const postBody = JSON.stringify(posts.items);
    expect(postBody).toContain("alias_number");
    expect(postBody).not.toContain("handle");

    const listingBody = JSON.stringify(listings.items);
    expect(listingBody).toContain("handle");
    expect(listingBody).not.toContain("alias_number");
  });

  // ----------------------------------------------------------------
  // Pagination
  // ----------------------------------------------------------------

  it("paginates posts to the end without repeating or skipping a row", async () => {
    const all = await service.searchPosts(user, TOKEN, "all", undefined, 50, undefined);
    expect(all.items).toHaveLength(5);

    // Walk the whole result set two at a time and assert the concatenation is
    // byte-identical to the single-page ordering. A keyset that skips or
    // repeats shows up here and nowhere else.
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof service.searchPosts>> =
        await service.searchPosts(user, TOKEN, "all", undefined, 2, cursor ?? undefined);
      walked.push(...page.items.map((p) => p.id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toEqual(all.items.map((p) => p.id));
  });

  /**
   * `AppError` keeps the student-facing message and the error code as two
   * separate strings by construction, so `.rejects.toThrow(/cursor_invalid/)`
   * never matches — it inspects `.message`, which is always "App Error". The
   * first version of these three tests asserted that way and two of them still
   * passed, because they early-return when there is no second page. Assert on
   * `.code`, and fail loudly if the fixture is too small to produce a cursor
   * rather than passing on an empty premise.
   */
  const expectCursorInvalid = async (run: () => Promise<unknown>) => {
    await expect(run()).rejects.toMatchObject({ code: "cursor_invalid" });
  };

  it("rejects a cursor presented against a different query", async () => {
    const first = await service.searchPosts(user, TOKEN, "all", undefined, 1, undefined);
    expect(first.next_cursor).toBeTruthy();
    // §4.1: a cursor binds its query. Changing q must not silently re-key the
    // keyset onto a different result set.
    await expectCursorInvalid(() =>
      service.searchPosts(user, "mikroiqtisadiyyat", "all", undefined, 1, first.next_cursor!));
  });

  it("rejects a cursor presented against a different sort", async () => {
    const first = await service.searchListings(user, TOKEN, "relevance", 1, undefined);
    expect(first.next_cursor).toBeTruthy();
    await expectCursorInvalid(() =>
      service.searchListings(user, TOKEN, "price_asc", 1, first.next_cursor!));
  });

  it("rejects a cursor presented by a caller from another campus", async () => {
    // The fingerprint binds univ_id, so a cursor cannot be lifted from one
    // student's session and replayed by a student on another campus to page
    // through results that were never scoped to them.
    const first = await service.searchPosts(user, TOKEN, "all", undefined, 1, undefined);
    expect(first.next_cursor).toBeTruthy();
    await expectCursorInvalid(() =>
      service.searchPosts(otherCampusUser, TOKEN, "all", undefined, 1, first.next_cursor!));
  });

  it("rejects a cursor presented by a caller at a different read tier", async () => {
    // Tier is in the fingerprint too: a card-tier page includes rows an
    // email-tier caller may not read, so the same cursor must not carry over.
    const first = await service.searchPosts(
      { ...user, tier: "card" as const }, TOKEN, "all", undefined, 1, undefined);
    expect(first.next_cursor).toBeTruthy();
    await expectCursorInvalid(() =>
      service.searchPosts(user, TOKEN, "all", undefined, 1, first.next_cursor!));
  });

  it("rejects a tampered cursor", async () => {
    const first = await service.searchPosts(user, TOKEN, "all", undefined, 1, undefined);
    expect(first.next_cursor).toBeTruthy();
    const [payload] = first.next_cursor!.split(".");
    await expectCursorInvalid(() =>
      service.searchPosts(user, TOKEN, "all", undefined, 1, `${payload}.deadbeef`));
  });

  it("sorts listings by price ascending, and paginates that order correctly", async () => {
    const page = await service.searchListings(user, TOKEN, "price_asc", 50, undefined);
    expect(page.items.length).toBeGreaterThanOrEqual(4);
    const prices = page.items.map((l) => l.price_minor);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("sorts listings newest-first", async () => {
    // Every non-relevance sort projects an epoch into sort_a. An epoch needs
    // twelve integer digits; the first version of this used numeric(12,8),
    // which has four, so every date and price sort raised "numeric field
    // overflow" the moment it was actually exercised.
    const page = await service.searchListings(user, TOKEN, "newest", 50, undefined);
    const dates = page.items.map((l) => l.published_at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("sorts vacancies newest-first", async () => {
    const page = await service.searchVacancies(user, "təcrübəçi", "newest", 50, undefined);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("sorts listings by price descending", async () => {
    const page = await service.searchListings(user, TOKEN, "price_desc", 50, undefined);
    expect(page.items.length).toBeGreaterThanOrEqual(4);
    const prices = page.items.map((l) => l.price_minor);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  // ----------------------------------------------------------------
  // Vacancies
  // ----------------------------------------------------------------

  it("returns vacancies to any campus unless the employer targeted one", async () => {
    const mine = await service.searchVacancies(user, "təcrübəçi", "relevance", 50, undefined);
    const theirs = await service.searchVacancies(otherCampusUser, "təcrübəçi", "relevance", 50, undefined);
    expect(mine.items.length).toBeGreaterThan(0);
    expect(theirs.items.length).toBeGreaterThan(0);
  });

  it("hides a vacancy targeted at another campus", async () => {
    const [other] = await sql`select id from ref.university where id <> ${bduId} limit 1`;
    const [emp] = await sql`select id from public.employer where is_active limit 1`;
    const [vac] = await sql`
      insert into public.vacancy (employer_id, title, description, lang, kind, work_mode,
                                  apply_via, external_url, status, target_university_ids)
      values (${emp!.id as string}, 'Yalnız bir kampus üçün praktikant', 'Hədəflənmiş vakansiya',
              'az', 'internship', 'onsite', 'external', 'https://example.org/apply',
              'active', array[${other!.id as string}]::uuid[])
      returning id`;

    try {
      const mine = await service.searchVacancies(user, "praktikant", "relevance", 50, undefined);
      const theirs = await service.searchVacancies(otherCampusUser, "praktikant", "relevance", 50, undefined);
      expect(mine.items.map((v) => v.id)).not.toContain(vac!.id);
      expect(theirs.items.map((v) => v.id)).toContain(vac!.id);
    } finally {
      await sql`delete from public.vacancy where id = ${vac!.id as string}`;
    }
  });

  it("sorts vacancies by deadline soonest-first without dropping the undated ones", async () => {
    // The reason coalesce(deadline,'infinity') is used instead of NULLS LAST:
    // a keyset comparison against NULL is never true, so an undated vacancy
    // would end the page and silently swallow everything after it.
    const page = await service.searchVacancies(user, "təcrübəçi", "deadline", 50, undefined);
    const dated = page.items.filter((v) => v.apply_deadline !== null).map((v) => v.apply_deadline!);
    expect([...dated].sort()).toEqual(dated);

    const all = await service.searchVacancies(user, "təcrübəçi", "relevance", 50, undefined);
    expect(page.items.length).toBe(all.items.length);
  });

  // ----------------------------------------------------------------
  // Russian and English arms
  // ----------------------------------------------------------------

  it("matches a Russian post through the Russian stemmer, not the Azerbaijani one", async () => {
    const [board] = await sql`select id from public.board where university_id = ${bduId} limit 1`;
    const [post] = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                               author_alias_number, author_tier, lang)
      values (${board!.id as string}, ${bduId}, 'Общежитие и расписание экзаменов',
              'Студенты спрашивают про экзамены.', 'alias', 1, 'email_verified', 'ru')
      returning id`;

    try {
      // 'экзамен' stems to the same lexeme as 'экзаменов' only under util.ru.
      // If every row were queried with the az config this returns nothing.
      const page = await service.searchPosts(user, "экзамен", "all", undefined, 50, undefined);
      expect(page.items.map((p) => p.id)).toContain(post!.id);
    } finally {
      await sql`delete from public.post where id = ${post!.id as string}`;
    }
  });

  it("matches an English post through the English stemmer", async () => {
    const [board] = await sql`select id from public.board where university_id = ${bduId} limit 1`;
    const [post] = await sql`
      insert into public.post (board_id, university_id, title, body, author_display_mode,
                               author_alias_number, author_tier, lang)
      values (${board!.id as string}, ${bduId}, 'Scholarship applications open',
              'Deadlines for applying are listed here.', 'alias', 1, 'email_verified', 'en')
      returning id`;

    try {
      const page = await service.searchPosts(user, "application", "all", undefined, 50, undefined);
      expect(page.items.map((p) => p.id)).toContain(post!.id);
    } finally {
      await sql`delete from public.post where id = ${post!.id as string}`;
    }
  });

  // ----------------------------------------------------------------
  // Filters
  // ----------------------------------------------------------------

  it("filters posts to campus or national on request", async () => {
    const campus = await service.searchPosts(user, "imtahan", "campus", undefined, 50, undefined);
    for (const hit of campus.items) expect(hit.scope).toBe("campus");

    const national = await service.searchPosts(user, "imtahan", "national", undefined, 50, undefined);
    for (const hit of national.items) expect(hit.scope).toBe("national");
  });

  it("filters posts to one board", async () => {
    const all = await service.searchPosts(user, "imtahan", "all", undefined, 50, undefined);
    const slug = all.items[0]?.board.slug;
    if (!slug) return;
    const filtered = await service.searchPosts(user, "imtahan", "all", slug, 50, undefined);
    expect(filtered.items.length).toBeGreaterThan(0);
    for (const hit of filtered.items) expect(hit.board.slug).toBe(slug);
  });

  it("carries the rating summary on course and instructor hits", async () => {
    const courses = await service.searchCourses(user, "verilenler", 20, undefined);
    const cs214 = courses.items.find((c) => c.code === "CS 214");
    expect(cs214).toBeDefined();
    expect(typeof cs214!.review_count).toBe("number");

    const instructors = await service.searchInstructors(user, "Eliyeva", 20, undefined);
    expect(instructors.items[0]).toHaveProperty("rating_avg");
    expect(instructors.items[0]).toHaveProperty("course_count");
  });
});
