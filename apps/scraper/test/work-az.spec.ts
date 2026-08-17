import { describe, expect, it } from "vitest";
import { parseDetail, parseListing } from "../src/work-az.ts";

/** Shaped like the real page: JSON-LD plus the embedded seoTag. */
const ld = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "CX Intern",
    datePosted: "2026-08-16T15:16:17Z",
    validThrough: "2026-09-03",
    employmentType: ["INTERN"],
    // The sentinel work.az actually publishes on every posting.
    hiringOrganization: { "@type": "Organization", name: "Vakansiyalar" },
    jobLocation: [{ "@type": "Place", address: { addressLocality: "Bakı" } }],
    description: "<p><strong>Birbank</strong> olaraq müştəri təcrübəsini…</p>",
    ...over,
  });

const page = (over: Record<string, unknown> = {}, seoTag = '"seoTag":{"id":3,"name":"Birbank"}') =>
  `<body><script type="application/ld+json">${ld(over)}</script><div>${seoTag}</div></body>`;

describe("work.az listing parse", () => {
  it("extracts slugs and de-duplicates repeated links", () => {
    const html = `
      <a href="/vakansiyalar/cx-intern">CX Intern</a>
      <a href="/vakansiyalar/cx-intern">CX Intern</a>
      <a href="https://www.work.az/vakansiyalar/code-camp-it">Code Camp</a>
      <a href="/sirketler/birbank">Birbank</a>`;
    expect(parseListing(html).map((e) => e.slug)).toEqual(["cx-intern", "code-camp-it"]);
  });
});

describe("work.az detail parse", () => {
  it("reads structured fields from JSON-LD", () => {
    const v = parseDetail(page(), "cx-intern", "fallback")!;
    expect(v.title).toBe("CX Intern");
    expect(v.city).toBe("Bakı");
    expect(v.apply_deadline).toBe("2026-09-03T23:59:59.000Z");
    expect(v.external_url).toBe("https://www.work.az/vakansiyalar/cx-intern");
  });

  it("REJECTS the 'Vakansiyalar' sentinel as an employer name", () => {
    // work.az publishes this on every posting. Trusting it would resolve the
    // entire market to one fake company, which is worse than duplicates.
    const v = parseDetail(page(), "cx-intern", "x")!;
    expect(v.employer_name).toBe("Birbank");
    expect(v.employer_name).not.toBe("Vakansiyalar");
  });

  it("falls back to the bolded name in the description when seoTag is absent", () => {
    const v = parseDetail(page({}, ""), "cx-intern", "x")!;
    expect(v.employer_name).toBe("Birbank");
  });

  it("returns no employer rather than the sentinel when nothing else is found", () => {
    const v = parseDetail(page({ description: "<p>Heç bir ad yoxdur</p>" }, ""), "x", "x")!;
    // The ingestion endpoint refuses these on purpose.
    expect(v.employer_name).toBeUndefined();
  });

  it("never picks the site navigation up as an employer", () => {
    // The bug the first live dry run exposed: parsing visible text by label
    // matched the nav menu, so every vacancy claimed the same 90-character
    // employer name.
    const withNav = `<body><nav><a href="/sirketler/x">Şirkətlər</a>Mentorluq Tədbirlər Bloqlar</nav>
      <script type="application/ld+json">${ld()}</script><div>"seoTag":{"name":"Birbank"}</div></body>`;
    expect(parseDetail(withNav, "x", "x")!.employer_name).toBe("Birbank");
  });

  it("never picks marketing prose up as a city", () => {
    const withProse = `<body><p>filtrini "Bakı" seçərək, tarixə görə sıralama aparın</p>
      <script type="application/ld+json">${ld()}</script></body>`;
    // Comes from jobLocation, not from whatever text mentions a city.
    expect(parseDetail(withProse, "x", "x")!.city).toBe("Bakı");
  });

  it("IGNORES JSON-LD salary when the page says negotiable", () => {
    // work.az emits baseSalary 1000 on postings whose visible page reads
    // "Maaş müzakirəyə əsasən". Both sampled postings did. Publishing it would
    // tell students every internship pays 1000 ₼, and someone would choose a
    // placement on that.
    const negotiable = page({
      baseSalary: { currency: "AZN", value: { value: 1000, unitText: "MONTH" } },
    }) + "<p>Maaş müzakirəyə əsasən</p>";
    const v = parseDetail(negotiable, "x", "x")!;
    expect(v.stipend_minor).toBeUndefined();
    expect(v.is_paid).toBeUndefined();
  });

  it("carries a figure when the page does not call it negotiable", () => {
    const v = parseDetail(page({
      baseSalary: { currency: "AZN", value: { value: 700, unitText: "MONTH" } },
    }), "x", "x")!;
    expect(v.stipend_minor).toBe(70000);   // 700 ₼, minor units
    expect(v.is_paid).toBe(true);
  });

  it("finds the employer even though seoTag quotes arrive escaped", () => {
    // The live page embeds seoTag inside a JSON string, so its quotes are \".
    const escaped = `<body><script type="application/ld+json">${ld()}</script>
      <div>{\"seoTag\":{\"id\":3,\"name\":\"Birbank\"}}</div></body>`;
    expect(parseDetail(escaped, "x", "x")!.employer_name).toBe("Birbank");
  });

  it("falls back to the listing title when JSON-LD is missing", () => {
    const v = parseDetail("<body><p>no structured data</p></body>", "slug", "Listing Title")!;
    expect(v.title).toBe("Listing Title");
  });

  it("survives malformed JSON-LD rather than throwing", () => {
    const bad = '<body><script type="application/ld+json">{not json</script></body>';
    expect(parseDetail(bad, "slug", "Fallback")!.title).toBe("Fallback");
  });

  it("detects remote and hybrid", () => {
    expect(parseDetail(page() + "<p>Uzaqdan</p>", "x", "x")!.work_mode).toBe("remote");
    expect(parseDetail(page() + "<p>Hibrid</p>", "x", "x")!.work_mode).toBe("hybrid");
    expect(parseDetail(page(), "x", "x")!.work_mode).toBe("onsite");
  });
});
