# Kiksu — shared agent brief

Read this before doing anything. Every agent works against this file.

## What Kiksu is
A mobile app for university students in Azerbaijan combining academic tools
(timetable, attendance, GPA) with anonymous social features (forum boards,
course/professor reviews, marketplace, job vacancies). Reference competitor:
Everytime (South Korea). Users are verified students but appear pseudonymously.

Default language Azerbaijani (az), with Russian (ru) and English (en) as
first-class alternates. UI copy in the design file is Azerbaijani.

## Confirmed decisions — do not relitigate
- **Platforms**: iOS *and* Android from one codebase. React Native + Expo SDK 54+, TypeScript strict.
- **Navigation**: **Drawer navigator** (NOT bottom tabs). The design mockups show a
  bottom tab bar; that element is superseded. Drawer destinations: Bu gün, Cədvəl,
  Forum, Bazar, Karyera (vacancies+events), Profil.
- **Backend**: Supabase (Postgres 17) for database, auth, storage, realtime.
- **Client never gets direct table grants on identity tables.** All identity-sensitive
  reads and all writes go through a server layer. RLS is defence in depth, not the
  only defence.
- **ORM/migrations**: Drizzle, SQL-first.

## The four identity layers — the core architecture
This is the product's central promise. Getting it wrong is unrecoverable.

1. **verified_identity** (sealed) — university, faculty, entry year, verification
   evidence. Encrypted, access logged, NEVER rendered in any user-facing surface.
2. **app_user** (persistent pseudonym) — handle, karma, tier, trade rating. What
   other students see. Handles are GENERATED (`sakit-pərvanə-37` = adjective-noun-number
   from a curated Azerbaijani wordlist), changeable every 14 days.
3. **thread_alias** (ephemeral) — `Anonim 1`, `Anonim 2`, scoped to one thread,
   never reused across threads.
4. **career_profile** (opt-in, siloed) — real name + CV.
   **SCOPE CHANGE: Kiksu no longer collects this at all.** Vacancies are
   scraped from employers' own sites and the student is handed off to apply
   there, so there is no CV, no career profile and no application in the
   product. The `career.*` tables remain in the schema but are unused.

   The consequence is worth stating: **Kiksu holds no real names anywhere.**
   Layer 4 existed solely to keep a real name away from the pseudonym; with
   nothing collecting one, that entire risk surface is gone rather than
   merely walled off.

### Hard invariants (must be enforced as failing tests, not conventions)
- No query outside the verification/legal-request services may join
  `verified_identity` to `app_user`.
- NOTHING may ever join `career_profile` to `app_user`. (Still enforced by
  invariant 2, and now trivially true since nothing writes those tables. Keep
  the check: it costs nothing and it is what stops the layer quietly coming
  back if applications are ever added.)
- **k-anonymity floor**: any displayed attribute combination matching fewer than
  20 verified users must render at a coarser level. Small-cohort de-anonymisation
  (e.g. "3rd year, Petroleum Engineering" on a 9-person programme) is the top risk.
- One verified person = one app_user, enforced via salted credential hash.

## Facts extracted from the design file (design/kiksu-mobile-screens.html)
The design is the source of truth for UI and for these behaviours:
- Verification tiers are VISIBLE BADGES on posts: `ANONİM ✓` (email-verified) vs
  `ANONİM KART` (card-verified). Tier must be cheap to read on every post.
- Verification routes: **university email and student card ONLY**. Invite codes
  were considered and dropped by product decision — a 6-digit invite is not a
  credential at realistic volumes, and two working routes cover the market.
  Advertised SLAs: email "2 dəqiqə" (recommended), card "24 saata qədər"
  (manual review).
- The composer shows the alias you WILL get before you post ("ANONİM 5 KİMİ YAZ").
  Alias assignment must be queryable ahead of the write AND reserved against races.
- Attendance shown as `4 / 12` with "33% of allowed absences used" and expulsion at
  the limit. Limit is per-course/per-university config, not a global constant.
- Review criteria are FIXED (4 axes): Dərs keyfiyyəti (quality), Ədalətli qiymət
  (fairness), İş yükü (workload), Davamiyyət tələbi (attendance strictness).
  Plus a tag vocabulary. Use fixed columns, not EAV.
- Reviews are keyed `course × instructor × semester` (design shows "2024/25 YAZ · CS 214").
- Seller stats: rating, deal count, response rate %, response time, complaint count.
  These are materialised counters, not live aggregates.
- Boards carry follower counts (9,214) — counter cache, not COUNT(*).
- Universities in the design: BDU (Bakı Dövlət Universiteti), ADA, UNEC, BMU.
  Email domain pattern: `ad.soyad@std.bsu.edu.az`.
- Currency is AZN (₼). Semesters named like "2025/26 Payız" / "2024/25 Yaz".
- Weekday labels: B.E, Ç.A, Ç, C.A, C (Mon–Fri).

## Design tokens (from the design file)
The design file names five colors itself, in Azerbaijani — use these names:
- `#0F7A85` **Şirvan turkuazı** — primary
- `#C8952A` **Tunc** — bronze, the card-verification tier
- `#B23A2F` **Nar** — pomegranate, deadlines and urgency
- `#141C24` **Xəzər mürəkkəbi** — ink, primary text
- `#F1F0EC` **Bakı əhəngdaşı** — limestone, page background

Full extracted set with usage counts: `packages/tokens/tokens.ts` (45 colors).
That file is generated from the design and is the single source of truth for
styling — do not hardcode hex values anywhere else.

## Output conventions
- Write deliverables into `docs/`. Use exactly the filename you are told.
- SQL must be readable and commented. No ORM DSL in the schema deliverable.
- Do NOT write application code in stage 1. Contracts only.
- If you hit something the brief does not specify, WRITE IT DOWN in an
  `## Open questions` section at the end of your file rather than guessing.
  This is especially true for anything touching identity semantics.
