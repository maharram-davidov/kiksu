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

## Not yet seeded

Forum posts and comments, reviews, marketplace listings, vacancies, and
`app_user` rows. These need care rather than volume, and the reason is the
identity model:

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
