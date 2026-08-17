import { fetchRobots, isAllowed } from "./robots.ts";
import { LISTING_PATH, WORK_AZ_ORIGIN, parseDetail, parseListing, type ScrapedVacancy } from "./work-az.ts";

/**
 * work.az internship scraper.
 *
 *   npm run scrape -w @kiksu/scraper -- --dry-run
 *   npm run scrape -w @kiksu/scraper -- --api http://localhost:3000 --token <jwt>
 *
 * Politeness is not decoration here. This runs against someone else's server:
 * it identifies itself, honours robots.txt read fresh each run, waits between
 * requests, and caps how much it fetches. A scraper that hammers a site gets
 * the whole product blocked.
 */

const UA =
  "KiksuBot/0.1 (+https://kiksu.az/bot; student vacancy aggregation; contact@kiksu.az)";
/** No Crawl-delay is published, so we choose a conservative one ourselves. */
const DEFAULT_DELAY_MS = 1500;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const DRY_RUN = has("dry-run");
const LIMIT = Number(flag("limit") ?? 25);
const API = flag("api") ?? "http://localhost:3000";
const TOKEN = flag("token") ?? process.env.KIKSU_STAFF_TOKEN;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

async function main(): Promise<void> {
  console.log(`work.az scraper — ${DRY_RUN ? "DRY RUN" : `posting to ${API}`}`);

  const robots = await fetchRobots(WORK_AZ_ORIGIN, UA);
  const delay = robots.crawlDelayMs ?? DEFAULT_DELAY_MS;

  if (!isAllowed(robots, LISTING_PATH)) {
    // Refuse rather than warn. The point of reading robots.txt is to obey it.
    console.error(`robots.txt disallows ${LISTING_PATH}. Refusing to crawl.`);
    process.exit(2);
  }
  console.log(`robots.txt allows ${LISTING_PATH}; waiting ${delay}ms between requests`);

  const listingHtml = await get(`${WORK_AZ_ORIGIN}${LISTING_PATH}`);
  const entries = parseListing(listingHtml).slice(0, LIMIT);
  console.log(`listing page: ${entries.length} vacancies (limit ${LIMIT})`);

  const scraped: ScrapedVacancy[] = [];
  let skipped = 0;

  for (const entry of entries) {
    const path = `/vakansiyalar/${entry.slug}`;
    if (!isAllowed(robots, path)) {
      skipped++;
      continue;
    }
    await sleep(delay);

    try {
      const detail = parseDetail(await get(`${WORK_AZ_ORIGIN}${path}`), entry.slug, entry.title);
      if (!detail) { skipped++; continue; }
      if (!detail.employer_name) {
        // The endpoint would refuse it anyway; saying so here makes a parser
        // regression visible instead of silently shrinking every run.
        console.warn(`  no employer found for ${entry.slug} — will be refused`);
      }
      scraped.push(detail);
      console.log(`  ${detail.employer_name ?? "?"} — ${detail.title.slice(0, 60)}`);
    } catch (e) {
      console.warn(`  failed ${entry.slug}: ${String(e)}`);
      skipped++;
    }
  }

  console.log(`\nscraped ${scraped.length}, skipped ${skipped}`);

  if (DRY_RUN) {
    console.log(JSON.stringify(scraped.slice(0, 3), null, 2));
    console.log("dry run — nothing posted");
    return;
  }

  if (!TOKEN) {
    console.error("no --token or KIKSU_STAFF_TOKEN; refusing to post");
    process.exit(2);
  }

  const res = await fetch(`${API}/v1/admin/ingest/vacancies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "X-Kiksu-Client": "scraper",
    },
    body: JSON.stringify({
      source: "work.az",
      vacancies: scraped,
      // Only on a COMPLETE run. A partial scrape that closed everything it
      // failed to reach would empty the feed.
      ...(skipped === 0 ? { close_missing_after_minutes: 1440 } : {}),
    }),
  });

  if (!res.ok) {
    console.error(`ingest failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log("ingest:", await res.json());
  if (skipped > 0) {
    console.log("skipped rows this run, so stale vacancies were NOT closed");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
