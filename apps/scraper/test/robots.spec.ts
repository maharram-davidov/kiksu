import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "../src/robots.ts";

/** The real work.az file, as fetched. */
const WORK_AZ = `User-agent: *
Disallow: /giris
Disallow: /qeydiyyat/
Disallow: /profil/
Disallow: /kabinetim/
Disallow: /invoices/
Disallow: /invoice/
Sitemap: https://work.az/sitemap.xml`;

describe("robots.txt", () => {
  const rules = parseRobots(WORK_AZ);

  it("permits the pages this scraper needs", () => {
    expect(isAllowed(rules, "/tecrube-proqramlari")).toBe(true);
    expect(isAllowed(rules, "/vakansiyalar/cx-intern")).toBe(true);
  });

  it("refuses the paths work.az disallows", () => {
    for (const p of ["/giris", "/qeydiyyat/x", "/profil/1", "/kabinetim/", "/invoice/9"]) {
      expect(isAllowed(rules, p)).toBe(false);
    }
  });

  it("only obeys the wildcard group, never another bot's rules", () => {
    const r = parseRobots(`User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private`);
    // Googlebot's blanket Disallow must not be applied to us…
    expect(isAllowed(r, "/anything")).toBe(true);
    // …but our own group must be.
    expect(isAllowed(r, "/private/x")).toBe(false);
  });

  it("lets a longer Allow override a Disallow, per the standard", () => {
    const r = parseRobots(`User-agent: *
Disallow: /jobs
Allow: /jobs/public`);
    expect(isAllowed(r, "/jobs/secret")).toBe(false);
    expect(isAllowed(r, "/jobs/public/1")).toBe(true);
  });

  it("treats an empty Disallow as permitting everything", () => {
    const r = parseRobots("User-agent: *\nDisallow:");
    expect(isAllowed(r, "/anything")).toBe(true);
  });

  it("reads a Crawl-delay when one is published", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 5").crawlDelayMs).toBe(5000);
    expect(rules.crawlDelayMs).toBeNull();   // work.az publishes none
  });

  it("ignores comments", () => {
    const r = parseRobots("# a note\nUser-agent: *\nDisallow: /x # trailing");
    expect(isAllowed(r, "/x")).toBe(false);
    expect(isAllowed(r, "/y")).toBe(true);
  });
});
