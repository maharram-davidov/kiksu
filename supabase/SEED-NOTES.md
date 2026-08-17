# Seed notes

`supabase/seed.sql` is idempotent — every insert guards on a natural key, and
`scripts/seed-local.sh` runs it twice to prove that.

## What is seeded

Reference data and the academic spine: 4 universities with email domains and
per-institution absence policy, the 2025/26 Payız term, campuses and rooms,
faculties, 5 instructors, 8 courses, 8 sections, 10 weekly meetings, 7 boards.

Content is taken from `design/kiksu-mobile-screens.html` so the designed screens
render with real data. The week grid reconstructs the design exactly — CS 214
"Verilənlər bazası sistemləri" on Ç.A at 14:05–15:25 in room 312 with dos. Nigar
Əliyeva is the card the Today screen shows as "45 DƏQ SONRA", and
`ref.effective_absence_limit()` returns the 12 behind the design's "4 / 12".

## Content seed (`seed-content.sql`)

Users, forum threads, a poll, and 61 reviews. Split from `seed.sql` because
this half touches the identity model and had to be got right rather than
merely got in. Verified on the seeded database:

- **Zero** rows carry authorship in `public.post.author_app_user_id` or
  `public.post_comment.author_app_user_id`. All 6 posts and 3 comments have
  their authorship in `internal.post_author` / `internal.comment_author`.
- Thread aliases come from `internal.allocate_thread_alias()`, not hand-written
  inserts. The OP provably holds ordinal 1 (the helper raises if it does not,
  per identity spec P4) and commenters get 2, 3, 4 — exactly the design's
  `ANONİM 1 MÜƏLLİF` through `ANONİM 4`.
- The opt-in campus badge is set on exactly one post, on the national board.
  The database rejects it anywhere else.

### The design's professor numbers do not quite reconcile

The review page shows dos. Nigar Əliyeva at **4.2** overall with histogram
5:35 4:16 3:7 2:2 1:1. That histogram sums to 61 reviews, which matches the
stated count — but its weighted mean is 265/61 = **4.34**, which rounds to 4.3,
not 4.2.

The seed reproduces the histogram exactly and therefore reports 4.3. The four
criterion averages match the design exactly (4.6 / 4.0 / 3.5 / 2.9) via
per-star lookup tables chosen to land on those means. Fudging the overall to
4.2 would mean either breaking the histogram or writing the aggregate directly
past the trigger that maintains it — both worse than a 0.1 discrepancy.
Worth confirming which number the design intends.

## Still not seeded

Marketplace listings and vacancies. Same reasoning as below applied to those:

- Anonymous post authorship belongs in `internal.post_author`, NOT in
  `public.post.author_app_user_id`, which stays NULL for anonymous posts. Seeding
  that wrong would model the anonymity architecture backwards and every later
  reader of the seed would copy the mistake.
- Thread aliases belong in `internal.thread_alias` and must be allocated through
  `internal.allocate_thread_alias()` so the OP holds ordinal 1 and the gapless
  reclaim rule is exercised, rather than hand-written.
- Review aggregates in the three summary tables are trigger-maintained. The
  design shows dos. Nigar Əliyeva at 4.2 from 61 reviews across 3 courses, so the
  individual review rows must actually add up to that rather than the aggregate
  being written directly.

## Open questions

1. `app_user` rows need `auth.users` rows first. For local development those can
   be synthesised, but seeding a real Supabase project means creating real auth
   users, which is a side effect worth being deliberate about. Local-only for now.
2. Should seed data exist in the production project at all, or only the
   reference/academic spine with content left to real users? Seeding fake forum
   posts into a live campus launch would be visible to students.
