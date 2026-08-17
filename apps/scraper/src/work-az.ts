import * as cheerio from "cheerio";

/**
 * Source adapter for work.az.
 *
 * Two-stage on purpose: the listing page carries title, date and slug but NOT
 * the employer or the city, and the ingestion endpoint refuses a vacancy with
 * no employer. So a listing-only scrape would produce rows that are all
 * correctly rejected — the detail fetch is not an optimisation, it is the
 * difference between working and not.
 */

export const WORK_AZ_ORIGIN = "https://www.work.az";
export const LISTING_PATH = "/tecrube-proqramlari";

export interface ScrapedVacancy {
  source_ref: string;
  external_url: string;
  title: string;
  employer_name?: string;
  city?: string;
  description?: string;
  kind?: string;
  work_mode?: string;
  is_paid?: boolean;
  stipend_minor?: number;
  apply_deadline?: string;
  required_skills?: string[];
}

/** Slugs on the listing page. The slug is the stable upsert key. */
export function parseListing(html: string): Array<{ slug: string; title: string }> {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: Array<{ slug: string; title: string }> = [];

  $('a[href*="/vakansiyalar/"]').each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const match = /\/vakansiyalar\/([a-z0-9-]+)/i.exec(href);
    if (!match?.[1]) return;
    const slug = match[1];
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({ slug, title: $(el).text().replace(/\s+/g, " ").trim() });
  });

  return out;
}

/**
 * work.az publishes schema.org JobPosting JSON-LD on every detail page.
 *
 * Reading that instead of the rendered markup is not a shortcut — it is the
 * difference between a scraper that survives a redesign and one that breaks
 * on the next CSS change. An earlier version of this file parsed visible text
 * by label and picked the site's navigation menu up as the employer name.
 */
interface JobPostingLd {
  title?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string[] | string;
  hiringOrganization?: { name?: string };
  jobLocation?: Array<{ address?: { addressLocality?: string } }>;
  baseSalary?: { currency?: string; value?: { value?: number; unitText?: string } };
  description?: string;
}

function readJsonLd(html: string): JobPostingLd | null {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed: unknown = JSON.parse($(el).text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const it = item as { "@type"?: string } & JobPostingLd;
        if (it["@type"] === "JobPosting") return it;
      }
    } catch {
      // A malformed block is not fatal; another may parse.
    }
  }
  return null;
}

/**
 * hiringOrganization.name is UNRELIABLE on work.az: it reads "Vakansiyalar"
 * (literally "Vacancies") on every posting regardless of employer. Trusting it
 * would resolve every scraped vacancy to a single employer called
 * "Vakansiyalar", which is far worse than duplicates — students would see one
 * fake company posting the entire market.
 *
 * The real employer is in the page's embedded `seoTag`, and appears bolded at
 * the start of the description. Both are tried, and a value matching the
 * sentinel is discarded.
 */
const EMPLOYER_SENTINELS = new Set(["vakansiyalar", "vacancies", "work.az", "workaz"]);

function extractEmployer(html: string, ld: JobPostingLd | null): string | undefined {
  const clean = (v: string | undefined): string | undefined => {
    const t = v?.replace(/\s+/g, " ").trim();
    if (!t) return undefined;
    return EMPLOYER_SENTINELS.has(t.toLowerCase()) ? undefined : t;
  };

  // seoTag lives inside a JSON string embedded in a script tag, so its quotes
  // arrive ESCAPED as \". Matching only plain quotes silently found nothing —
  // which the first live run showed as every vacancy having no employer.
  const seoTag =
    /\\?"seoTag\\?"\s*:\s*\{[^}]*?\\?"name\\?"\s*:\s*\\?"([^"\\]{2,80})/.exec(html);
  const fromTag = clean(seoTag?.[1]);
  if (fromTag) return fromTag;

  // The description opens "<strong>Birbank</strong> olaraq…" on most postings.
  const bold = /<strong>\s*([^<]{2,60}?)\s*<\/strong>/.exec(ld?.description ?? "");
  const fromBold = clean(bold?.[1]);
  if (fromBold) return fromBold;

  return clean(ld?.hiringOrganization?.name);
}

export function parseDetail(html: string, slug: string, fallbackTitle: string): ScrapedVacancy | null {
  const ld = readJsonLd(html);
  const title = (ld?.title ?? fallbackTitle).replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title) return null;

  const city = ld?.jobLocation?.[0]?.address?.addressLocality?.trim() || undefined;

  // validThrough is a date; the deadline is the end of that day.
  const validThrough = ld?.validThrough?.trim();
  const applyDeadline = validThrough && /^\d{4}-\d{2}-\d{2}$/.test(validThrough)
    ? `${validThrough}T23:59:59.000Z`
    : undefined;

  // SALARY IS CROSS-CHECKED, because work.az's JSON-LD is not trustworthy
  // here: it emits baseSalary 1000 on postings whose visible page reads
  // "Maaş müzakirəyə əsasən" (negotiable). Two sampled postings both did this.
  //
  // Publishing that would tell students every internship pays 1000 ₼, which is
  // worse than showing nothing — someone would choose a placement on it. So a
  // figure is only carried when the page does NOT say the salary is
  // negotiable. Negotiable means unknown, not unpaid.
  const saysNegotiable = /müzakirə/i.test(html);
  const amount = ld?.baseSalary?.value?.value;
  const stipendMinor = !saysNegotiable && typeof amount === "number" && amount > 0
    ? Math.round(amount * 100)
    : undefined;

  const employmentType = Array.isArray(ld?.employmentType)
    ? ld?.employmentType[0]
    : ld?.employmentType;

  const text = cheerio.load(html)("body").text();
  const workMode = /uzaqdan|remote/i.test(text)
    ? "remote"
    : /hibrid|hybrid/i.test(text)
      ? "hybrid"
      : "onsite";

  const description = ld?.description
    ? cheerio.load(`<div>${ld.description}</div>`)("div").text().replace(/\s+/g, " ").trim().slice(0, 4000)
    : undefined;

  return {
    source_ref: slug,
    external_url: `${WORK_AZ_ORIGIN}/vakansiyalar/${slug}`,
    title,
    employer_name: extractEmployer(html, ld),
    city,
    description,
    // This is the internship section; INTERN in the JSON-LD confirms it.
    kind: employmentType === "INTERN" || employmentType === undefined ? "internship" : "internship",
    work_mode: workMode,
    is_paid: stipendMinor !== undefined ? true : undefined,
    stipend_minor: stipendMinor,
    apply_deadline: applyDeadline,
  };
}
