import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { CommerceService } from "../src/modules/commerce/commerce.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("commerce service (integration)", () => {
  let sql: postgres.Sql;
  let service: CommerceService;
  let user: KiksuRequestContext;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    service = new CommerceService({ sql } as never);
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    if (!uni) throw new Error("seed missing: BDU");
    user = {
      authUserId: "a", appUserId: "b", tier: "email",
      role: "student", univId: uni.id, epoch: 1, sid: "test",
    };
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("returns the design's textbook listing with price in minor units", async () => {
    const listings = await service.listListings(user);
    const book = listings.find((l) => l.title.startsWith("Piskunov"));
    expect(book).toBeDefined();
    // 25 ₼ is 2500 qəpik. Money is never a float anywhere in this system.
    expect(book!.price_minor).toBe(2500);
    expect(book!.currency).toBe("AZN");
    expect(book!.is_negotiable).toBe(true);
    expect(book!.condition).toBe("good");
  });

  it("carries the seller's persistent reputation, matching the design", async () => {
    const listings = await service.listListings(user);
    const book = listings.find((l) => l.title.startsWith("Piskunov"))!;
    const s = book.seller!;
    expect(s.handle).toBe("quru-püstə-19");
    expect(Number(s.trade_rating_avg)).toBeCloseTo(4.8, 1);
    expect(s.deal_count).toBe(12);
    expect(s.response_rate_pct).toBe(100);
    expect(s.complaint_count).toBe(0);
  });

  it("exposes no identity fields on a seller beyond the agreed shape", async () => {
    const listings = await service.listListings(user);
    const s = listings.find((l) => l.seller)!.seller!;
    // A seller is pseudonymous-but-persistent by design, unlike a forum
    // author. That trade is deliberate — but it must not widen into karma,
    // account age or auth ids.
    expect(Object.keys(s).sort()).toEqual([
      "avatar_id", "complaint_count", "deal_count", "handle",
      "response_rate_pct", "response_time_median_sec",
      "trade_rating_avg", "university_code", "verification_status",
    ]);
  });

  it("filters listings by category", async () => {
    const books = await service.listListings(user, "textbooks");
    expect(books.length).toBeGreaterThan(0);
    expect(books.every((l) => l.category_key === "textbooks")).toBe(true);
  });

  it("leaks no other campus's listings", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const listings = await service.listListings({ ...user, univId: ada!.id });
    expect(listings).toHaveLength(0);
  });

  it("returns the design's vacancies with deadlines counted in whole days", async () => {
    const vacancies = await service.listVacancies(user);
    const azercell = vacancies.find((v) => v.employer.slug === "azercell");
    expect(azercell).toBeDefined();
    expect(azercell!.title).toBe("Frontend təcrübəçi (React)");
    expect(azercell!.work_mode).toBe("hybrid");
    expect(azercell!.stipend_minor).toBe(70000);   // 700 ₼
    expect(azercell!.days_left).toBeGreaterThanOrEqual(2);
    expect(azercell!.days_left).toBeLessThanOrEqual(3);
  });

  it("shows vacancies to every campus unless an employer targeted one", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const forAda = await service.listVacancies({ ...user, univId: ada!.id });
    // A job in Baku is open to any student; campus scoping applies to
    // listings, not to the labour market.
    expect(forAda.length).toBeGreaterThan(0);
  });

  it("filters vacancies by kind", async () => {
    const parttime = await service.listVacancies(user, "part_time");
    expect(parttime.length).toBeGreaterThan(0);
    expect(parttime.every((v) => v.kind === "part_time")).toBe(true);
  });
});
