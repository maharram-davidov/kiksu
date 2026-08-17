# Careers: aggregation, not applications

**Decision.** Kiksu does not take job applications. Vacancies are collected
from employers' own sites and the student taps through to apply there.

## What this removes

- No career profile, no CV, no application records.
- No real name, phone number or email collected anywhere in the product.
- `career.career_profile`, `career.career_document`, `career.application` and
  `career.application_event` are now **unused**. They are left in place rather
  than dropped, because dropping a schema is destructive and employer-side
  features may return; invariant 2 still guards them.

## Why it is a privacy improvement, not just a simplification

Layer 4 existed for one reason: applying for a job was the single place a real
name entered the system, and it had to be kept unlinkable to the pseudonym.
That was a risk to be *managed*. Removing applications removes the risk
entirely — there is no name to leak, mis-join or subpoena.

It also removes the product plan's largest unbuilt surface (CV builder,
application tracker, employer console) and the compliance weight that came with
holding student CVs.

## What it requires instead

**A scraper, and the operational commitment behind it.** Vacancies now have to
be collected, kept fresh, and expired when they close. A job board full of dead
links is worse than no job board: a student who applies to three closed
positions stops trusting the section.

Concretely, still to build:

1. **Ingestion.** A writer path for scraped vacancies — upsert by
   (employer, title, deadline) or a source URL key, so re-running a scrape
   updates rather than duplicates.
2. **Expiry.** Vacancies past `apply_deadline` already drop out of the feed.
   Ones that close early do not, and nothing currently notices.
3. **Employer identity.** `public.employer` rows are seeded by hand. A scraper
   needs to create them, and to avoid making four "Kapital Bank"s.
4. **Provenance.** Nothing records where a vacancy came from or when it was
   last seen. Both matter for debugging a scrape and for removing a source.

## Enforced in the API

`listVacancies` requires `external_url is not null`. A vacancy nobody can act
on is noise, and hiding it beats showing a card that goes nowhere.
