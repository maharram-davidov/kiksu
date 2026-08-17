# Vacancy ingestion

Kiksu aggregates vacancies rather than taking applications, so they arrive from
outside. This is where a scraper posts them.

    POST /v1/admin/ingest/vacancies    (staff only)

```json
{
  "source": "work.az",
  "vacancies": [
    {
      "source_ref": "cx-intern",
      "external_url": "https://www.work.az/vakansiyalar/cx-intern",
      "title": "CX Intern",
      "employer_name": "Kapital Bank",
      "kind": "internship",
      "city": "Bakı"
    }
  ],
  "close_missing_after_minutes": 1440
}
```

## The division of labour

The scraper parses a page. **Everything that has to be consistent across
scrapes lives here**, because a rule enforced in one scraper is a rule the next
scraper gets wrong:

- **Upsert key** is `(source, source_ref)`. Re-running a scrape updates rather
  than duplicating. For work.az the ref is the URL slug.
- **Employer resolution** is by folded name, so "Kapital Bank", "Kapital bank"
  and "KAPITAL BANK" across three pages are one employer.
- **Scraped employers are never marked verified.** The badge means Kiksu
  checked, and nobody checked this one.

## What it refuses

- **No employer → skip.** `employer_id` is NOT NULL, and attaching listings to
  an "Unknown Employer" placeholder is worse than dropping them: a student
  cannot judge whether to trust one.
- **No link → skip.** A vacancy nobody can act on is noise.
- **One bad row does not fail the batch.** A scrape that abandons everything
  over a single odd listing is a scrape nobody can rely on.

## Closing what the source dropped

`apply_deadline` handles positions that expire on schedule. A position **filled
early** just disappears from the source, and absence is the only signal.

`close_missing_after_minutes` closes anything from that source not seen inside
the window. Send it **only on the last page of a run** — closing after page one
would shut everything the run has not reached yet. The window itself is the
second guard: if the scraper crashed halfway, the rows it missed are minutes
old, not a day, and survive.

**A scrape is information, not authority.** Ingestion never overwrites `status`,
so a vacancy a moderator paused or closed stays that way even while the source
keeps listing it.

## What still does not exist

1. **The scraper.** This is the writer path; nothing currently calls it. The
   work.az listing page gives title, date, salary and slug, but **not the
   employer or city** — those are only on each detail page, so a usable scrape
   has to follow through to them.
2. **Scheduling.** No cron, no run history. Nothing records that a scrape ran,
   how long it took, or that it stopped running.
3. **Permission to scrape a given source.** Whether a site may be scraped is a
   question about its terms and robots.txt, not about this code. That call has
   to be made per source, before one is pointed at it.
