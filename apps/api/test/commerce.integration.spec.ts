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
    // Mirror SqlProvider: creation runs in a transaction.
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    service = new CommerceService(db as never);
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

  it("fetches a single listing directly, not by scanning the list", async () => {
    const listings = await service.listListings(user);
    const one = listings.find((l) => l.title.startsWith("Piskunov"))!;
    const direct = await service.getListing(user, one.id);
    expect(direct.id).toBe(one.id);
    expect(direct.seller!.handle).toBe(one.seller!.handle);
  });

  it("finds a listing that falls outside the list's page", async () => {
    // The old implementation fetched the first 50 and searched them, so a
    // listing past the 50th 404'd — a bug that only appears once the
    // marketplace is busy and looks like the listing was deleted.
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const [seller] = await sql`select id from public.app_user where handle = 'quru-püstə-19'`;
    const [cat] = await sql`select id from ref.marketplace_category where key = 'other'`;
    const [buried] = await sql`
      insert into public.listing (seller_id, university_id, category_id, title,
                                  price_minor, currency, status, published_at)
      values (${seller!.id}, ${uni!.id}, ${cat!.id}, 'Çox köhnə elan', 100, 'AZN',
              'active', now() - interval '400 days')
      returning id`;
    const found = await service.getListing(user, buried!.id);
    expect(found.title).toBe("Çox köhnə elan");
  });

  it("refuses a listing on another campus", async () => {
    const listings = await service.listListings(user);
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    await expect(
      service.getListing({ ...user, univId: ada!.id }, listings[0]!.id),
    ).rejects.toThrow();
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

  describe("creating a listing", () => {
    let seller: KiksuRequestContext;

    beforeAll(async () => {
      const [uni] = await sql`select id from ref.university where code = 'BDU'`;
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, 'satici-testi-01', ${uni!.id}, 'email_verified', 'active')
        returning id`;
      seller = { ...user, appUserId: u!.id };
    });

    it("creates a listing and returns it fully formed", async () => {
      const l = await service.createListing(seller, {
        categoryKey: "textbooks",
        title: "Diskret riyaziyyat konspekti",
        description: "Öz əlyazmam, imtahana hazırlaşmaq üçün kifayətdir.",
        priceMinor: 1500,
        isNegotiable: true,
        condition: "good",
        meetupNotes: ["Baş korpus, dərslər arası."],
        relatedCourseId: undefined,
      });
      expect(l.price_minor).toBe(1500);          // 15 ₼, never a float
      expect(l.is_negotiable).toBe(true);
      expect(l.seller!.handle).toBe("satici-testi-01");
      expect(l.meetup_notes).toContain("Baş korpus, dərslər arası.");
    });

    it("rejects an unknown category", async () => {
      await expect(service.createListing(seller, {
        categoryKey: "spaceships", title: "Test", priceMinor: 100,
        isNegotiable: false, condition: "good", meetupNotes: [],
      })).rejects.toThrow();
    });

    it("rejects a price beyond the ceiling, since zeros are easy to fumble", async () => {
      await expect(service.createListing(seller, {
        categoryKey: "other", title: "Mistyped", priceMinor: 999_999_00,
        isNegotiable: false, condition: "good", meetupNotes: [],
      })).rejects.toThrow();
    });

    it("rejects a course from another campus", async () => {
      const [ada] = await sql`select id from ref.university where code = 'ADA'`;
      const [course] = await sql`select id from ref.course limit 1`;
      await expect(service.createListing({ ...seller, univId: ada!.id }, {
        categoryKey: "textbooks", title: "Test", priceMinor: 100,
        isNegotiable: false, condition: "good", meetupNotes: [],
        relatedCourseId: course!.id,
      })).rejects.toThrow();
    });

    it("limits a listing containing a phone number, now that chat exists", async () => {
      const l = await service.createListing(seller, {
        categoryKey: "electronics",
        title: "Kalkulyator satılır",
        description: "Maraqlananlar 0505551234 nömrəsinə yazsın.",
        priceMinor: 4000, isNegotiable: false, condition: "good", meetupNotes: [],
      });

      const [row] = await sql`select moderation_state::text as s from public.listing where id = ${l.id}`;
      // Before deal chat this stayed visible, because a number was the only
      // way to reach a seller and limiting would have made the marketplace
      // unusable. Chat removed the excuse, so listings follow the same rule as
      // everything else.
      expect(row!.s).toBe("limited");

      const [c] = await sql`
        select opened_by, severity from moderation.mod_case where subject_id = ${l.id}`;
      // A human still gets to look at it.
      expect(c!.opened_by).toBe("automod");
      expect(c!.severity).toBe(5);
    });

    it("opens no case for an ordinary listing", async () => {
      const l = await service.createListing(seller, {
        categoryKey: "furniture", title: "Kitab rəfi",
        description: "İki illik istifadə, möhkəmdir.",
        priceMinor: 3000, isNegotiable: true, condition: "fair", meetupNotes: [],
      });
      const cases = await sql`select id from moderation.mod_case where subject_id = ${l.id}`;
      expect(cases).toHaveLength(0);
    });

    it("shows a new listing on the seller's own campus and nowhere else", async () => {
      const l = await service.createListing(seller, {
        categoryKey: "other", title: "Kampus yoxlaması",
        priceMinor: 500, isNegotiable: false, condition: "good", meetupNotes: [],
      });
      const [ada] = await sql`select id from ref.university where code = 'ADA'`;
      await expect(service.getListing({ ...seller, univId: ada!.id }, l.id)).rejects.toThrow();
      await expect(service.getListing(seller, l.id)).resolves.toBeTruthy();
    });
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
