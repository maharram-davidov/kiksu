import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { IngestService } from "../src/modules/ingest/ingest.service";
import { CommerceService } from "../src/modules/commerce/commerce.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SOURCE = "work.az-test";

/** Shaped like what the work.az listing page actually yields. */
const row = (ref: string, over: Record<string, unknown> = {}) => ({
  sourceRef: ref,
  externalUrl: `https://www.work.az/vakansiyalar/${ref}`,
  title: "Təcrübə Proqramı",
  employerName: "Kapital Bank",
  ...over,
});

suite("vacancy ingestion (integration)", () => {
  let sql: postgres.Sql;
  let ingest: IngestService;
  let commerce: CommerceService;
  let user: KiksuRequestContext;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    ingest = new IngestService(db as never);
    commerce = new CommerceService(db as never);
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    user = {
      authUserId: "a", appUserId: "b", tier: "email",
      role: "student", univId: uni!.id, epoch: 1, sid: "t",
    };
  });

  afterAll(async () => {
    await sql`delete from public.vacancy where source = ${SOURCE}`;
    await sql?.end({ timeout: 5 });
  });

  it("creates vacancies from a scrape", async () => {
    const res = await ingest.ingest(SOURCE, [
      row("cx-intern", { title: "CX Intern" }),
      row("code-camp-it", { title: "Code Camp İT təcrübə proqramı" }),
    ]);
    expect(res.created).toBe(2);
    expect(res.updated).toBe(0);
  });

  it("updates rather than duplicating when the scrape runs again", async () => {
    const res = await ingest.ingest(SOURCE, [row("cx-intern", { title: "CX Intern (yenilənib)" })]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);

    const rows = await sql`
      select title from public.vacancy where source = ${SOURCE} and source_ref = 'cx-intern'`;
    // Idempotency is the whole reason source_ref exists.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("CX Intern (yenilənib)");
  });

  it("resolves differently-cased employer names to ONE employer", async () => {
    await ingest.ingest(SOURCE, [
      row("emp-a", { employerName: "Bakcell" }),
      row("emp-b", { employerName: "BAKCELL" }),
      row("emp-c", { employerName: "bakcell" }),
    ]);
    const employers = await sql`
      select id from public.employer where name_key = util.fold_handle('Bakcell')`;
    // A scraper reading three pages must not create three Bakcells.
    expect(employers).toHaveLength(1);
  });

  it("does not mark a scraped employer as verified", async () => {
    const [e] = await sql`
      select is_verified from public.employer where name_key = util.fold_handle('Bakcell')`;
    // The badge means Kiksu checked. Nobody checked this one.
    expect(e!.is_verified).toBe(false);
  });

  it("skips a row with no employer rather than inventing a placeholder", async () => {
    const res = await ingest.ingest(SOURCE, [
      row("no-employer", { employerName: undefined }),
    ]);
    // "Unknown Employer" listings are worse than none: a student cannot judge
    // whether to trust them.
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("skips a row with no link, since a student could not act on it", async () => {
    const res = await ingest.ingest(SOURCE, [
      { ...row("no-link"), externalUrl: "" },
    ]);
    expect(res.skipped).toBe(1);
  });

  it("keeps going when one row in a batch is malformed", async () => {
    const res = await ingest.ingest(SOURCE, [
      row("good-1", { title: "Yaxşı sətir 1" }),
      { ...row("bad"), externalUrl: "" },
      row("good-2", { title: "Yaxşı sətir 2" }),
    ]);
    // A scrape that abandons everything over one odd listing is a scrape
    // nobody can rely on.
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(1);
  });

  it("surfaces ingested vacancies in the student-facing feed", async () => {
    const feed = await commerce.listVacancies(user);
    const mine = feed.find((v) => v.title === "CX Intern (yenilənib)");
    expect(mine).toBeDefined();
    expect(mine!.external_url).toContain("work.az");
  });

  it("closes a vacancy the source has stopped listing", async () => {
    // Age one row past the window without touching the others.
    await sql`
      update public.vacancy set last_seen_at = now() - interval '3 days'
       where source = ${SOURCE} and source_ref = 'code-camp-it'`;

    const closed = await ingest.closeMissing(SOURCE, 24 * 60);
    expect(closed).toBeGreaterThanOrEqual(1);

    const [row0] = await sql`
      select status::text as s from public.vacancy
       where source = ${SOURCE} and source_ref = 'code-camp-it'`;
    // apply_deadline handles positions that expire on schedule; this is the
    // only signal for one filled early.
    expect(row0!.s).toBe("closed");
  });

  it("does not close rows the current run just touched", async () => {
    const [still] = await sql`
      select status::text as s from public.vacancy
       where source = ${SOURCE} and source_ref = 'cx-intern'`;
    // A crashed half-run must not shut everything it failed to reach.
    expect(still!.s).toBe("active");
  });

  it("leaves a status a moderator set alone", async () => {
    await sql`
      update public.vacancy set status = 'paused'
       where source = ${SOURCE} and source_ref = 'good-1'`;
    await ingest.ingest(SOURCE, [row("good-1", { title: "Yenidən görüldü" })]);

    const [v] = await sql`
      select status::text as s, title from public.vacancy
       where source = ${SOURCE} and source_ref = 'good-1'`;
    // A scrape is information, not authority.
    expect(v!.s).toBe("paused");
    expect(v!.title).toBe("Yenidən görüldü");
  });
});
