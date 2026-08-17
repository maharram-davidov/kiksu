# work.az scraper

Collects internship listings and posts them to `/v1/admin/ingest/vacancies`.

    npm run scrape -w @kiksu/scraper -- --dry-run --limit 5
    npm run scrape -w @kiksu/scraper -- --api http://localhost:3000 --token <staff-jwt>

## Politeness is not optional

This runs against someone else's server. It identifies itself with a
contactable User-Agent, **re-reads robots.txt every run** rather than trusting
a note somebody wrote once, waits 1.5s between requests (work.az publishes no
`Crawl-delay`, so we pick a conservative one), and caps how much it fetches.
A scraper that hammers a site gets the whole product blocked.

robots.txt is **obeyed, not warned about**: a disallowed path exits non-zero.

At time of writing work.az disallows only `/giris`, `/qeydiyyat/`, `/profil/`,
`/kabinetim/`, `/invoices/` and `/invoice/` — none of which this touches. That
is checked at runtime, not assumed.

## Two stages, because one is not enough

The listing page carries title, date and slug but **not the employer or city**.
The ingestion endpoint refuses a vacancy with no employer, so a listing-only
scrape would produce rows that are all correctly rejected. The detail fetch is
not an optimisation.

## Read the JSON-LD, not the markup

Every detail page publishes a schema.org `JobPosting` block. Parsing that
instead of rendered HTML is what makes this survive a redesign.

An earlier version parsed visible text by Azerbaijani label. The first live run
showed what that produces: **every vacancy claimed the same 90-character
employer name, which was the site's navigation menu**, and the city field was a
sentence of marketing copy. Synthetic test HTML had passed.

## Two sentinels in work.az's own data

Both were found only by running against the real site, and both would have
shipped confidently wrong data:

**`hiringOrganization.name` is always `"Vakansiyalar"`** — literally
"Vacancies". Trusting it would resolve every scraped listing to one fake
company posting the entire market, which is worse than duplicates. The real
employer is in the page's embedded `seoTag`, whose quotes arrive **escaped**
because it sits inside a JSON string. Matching plain quotes silently found
nothing.

**`baseSalary.value` is always `1000`**, including on postings whose visible
page reads "Maaş müzakirəyə əsasən" (negotiable). Two sampled postings both did
this. Publishing it would tell students every internship pays 1000 ₼, and
someone would choose a placement on that. A figure is therefore carried only
when the page does not say the salary is negotiable — **negotiable means
unknown, not unpaid**.

## Closing stale vacancies

`close_missing_after_minutes` is sent **only when the run skipped nothing**. A
partial scrape that closed everything it failed to reach would empty the feed.

## Still to do

1. **Pagination.** The listing page has a "Load More" button; only the first
   page is read, so `--limit` above roughly 20 gains nothing.
2. **Scheduling.** No cron and no run history — nothing records that a scrape
   ran, how long it took, or that it stopped running.
3. **`work.az/sitemap.xml` is published** and may be a better source than the
   listing page for finding slugs.
