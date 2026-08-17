import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { ForumService } from "../src/modules/forum/forum.service";
import { CursorService } from "../src/common/pagination/cursor.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

/**
 * Run via `scripts/test-integration.sh`, which applies migrations + both seeds.
 *
 * The point of this suite is not that the forum returns rows. It is that the
 * rows it returns cannot be joined back to a person. Several tests below would
 * pass trivially against an empty database, so they assert on the SEEDED
 * thread the design specifies — 1 (OP), 2, 3, 4 — and would fail loudly if
 * aliasing silently stopped working.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/** Every handle in the content seed. None may appear in any response. */
const SEEDED_HANDLES = [
  "sakit-pərvanə-37", "quru-püstə-19", "uzaq-ceyran-52", "isti-nar-08",
  "mavi-turac-71", "dinc-alma-24", "yaşıl-ənbər-63", "sərin-badam-15",
];

suite("forum service (integration)", () => {
  let sql: postgres.Sql;
  let service: ForumService;
  let user: KiksuRequestContext;
  let headlinePostId: string;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const cursors = new CursorService({
      cursorHmacSecret: "test-secret-at-least-32-chars-long-ok",
    } as never);
    service = new ForumService({ sql } as never, cursors);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    if (!uni) throw new Error("seed missing: BDU");
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    if (!authUser) throw new Error("failed to create auth user");
    const [appUser] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${authUser.id}, 'forum-test-oxucu-01', ${uni.id}, 'email_verified', 'active')
      returning id`;
    if (!appUser) throw new Error("failed to create app_user");

    const [post] = await sql`select id from public.post where title like 'Mikroiqtisadiyyat%'`;
    if (!post) throw new Error("seed missing: headline thread");
    headlinePostId = post.id;

    user = {
      authUserId: authUser.id, appUserId: appUser.id, tier: "email",
      role: "student", univId: uni.id, epoch: 1, sid: "test",
    };
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("lists the caller's campus boards plus the national tier", async () => {
    const boards = await service.listBoards(user);
    const slugs = boards.map((b) => b.slug);
    expect(slugs).toContain("bdu-ders-ve-muellim");   // campus
    expect(slugs).toContain("milli-serbest");          // national
    expect(boards.find((b) => b.slug === "milli-serbest")!.university_code).toBeNull();
  });

  it("renders the design's thread as ANONİM 1 (MÜƏLLİF) then 2, 3, 4", async () => {
    const post = await service.getPost(user, headlinePostId);
    expect(post.author.alias_number).toBe(1);
    expect(post.author.is_op).toBe(true);
    expect(post.comments.map((c) => c.author.alias_number)).toEqual([2, 3, 4]);
    expect(post.comments.every((c) => c.author.is_op === false)).toBe(true);
  });

  it("offers the caller alias 5, matching the composer's ANONİM 5 KİMİ YAZ", async () => {
    const post = await service.getPost(user, headlinePostId);
    expect(post.your_next_alias).toBe(5);
  });

  it("is idempotent: re-opening the thread offers the same alias, not a new one", async () => {
    const a = await service.getPost(user, headlinePostId);
    const b = await service.getPost(user, headlinePostId);
    expect(a.your_next_alias).toBe(b.your_next_alias);
  });

  it("LEAKS NO HANDLE anywhere in a post detail response", async () => {
    const json = JSON.stringify(await service.getPost(user, headlinePostId));
    for (const handle of SEEDED_HANDLES) {
      expect(json).not.toContain(handle);
    }
  });

  it("LEAKS NO app_user_id anywhere in a post detail response", async () => {
    const ids = await sql<Array<{ id: string }>>`select id from public.app_user`;
    const json = JSON.stringify(await service.getPost(user, headlinePostId));
    for (const { id } of ids) {
      expect(json).not.toContain(id);
    }
  });

  it("LEAKS NO handle through the board feed either", async () => {
    const json = JSON.stringify(await service.getBoardFeed(user, "bdu-ders-ve-muellim", null));
    for (const handle of SEEDED_HANDLES) {
      expect(json).not.toContain(handle);
    }
  });

  it("exposes no author key at all on the wire beyond alias, tier and is_op", async () => {
    const post = await service.getPost(user, headlinePostId);
    expect(Object.keys(post.author).sort()).toEqual(["alias_number", "is_op", "tier"]);
    for (const c of post.comments) {
      expect(Object.keys(c.author).sort()).toEqual(["alias_number", "is_op", "tier"]);
    }
  });

  it("renders the seeded poll with the design's split", async () => {
    const [pollPost] = await sql`select id from public.post where kind = 'poll' limit 1`;
    const post = await service.getPost(user, pollPost!.id);
    expect(post.poll).not.toBeNull();
    expect(post.poll!.total_votes).toBe(428);
    const dm = post.poll!.options.find((o) => o.label === "Data Mining");
    expect(dm!.vote_count).toBe(274);   // 64%
  });

  it("shows the opt-in campus badge only where the author ticked it", async () => {
    const national = await service.getBoardFeed(user, "milli-serbest", null);
    expect(national.items.some((p) => p.author_university_code === "BDU")).toBe(true);
    const campus = await service.getBoardFeed(user, "bdu-ders-ve-muellim", null);
    expect(campus.items.every((p) => p.author_university_code === null)).toBe(true);
  });

  it("hides another campus's board from this caller", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const boards = await service.listBoards({ ...user, univId: ada!.id });
    expect(boards.map((b) => b.slug)).not.toContain("bdu-ders-ve-muellim");
    await expect(
      service.getBoardFeed({ ...user, univId: ada!.id }, "bdu-ders-ve-muellim", null),
    ).rejects.toThrow();
  });

  it("refuses a post on another campus's board", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    await expect(
      service.getPost({ ...user, univId: ada!.id }, headlinePostId),
    ).rejects.toThrow();
  });

  it("paginates by keyset and rejects a tampered cursor", async () => {
    const page = await service.getBoardFeed(user, "bdu-ders-ve-muellim", null, 1);
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).not.toBeNull();
    const next = await service.getBoardFeed(user, "bdu-ders-ve-muellim", page.next_cursor, 1);
    expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    await expect(
      service.getBoardFeed(user, "bdu-ders-ve-muellim", page.next_cursor! + "x", 1),
    ).rejects.toThrow();
  });
});
