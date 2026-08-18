# Kiksu — session handoff

Everything a fresh session needs to continue. Read this first, then
`docs/00-project-brief.md`.

## What Kiksu is

A mobile app for university students in Azerbaijan combining academic tools
(timetable, attendance, GPA) with anonymous social features (forum boards,
course and professor reviews, a marketplace) plus aggregated job vacancies.
Reference competitor: Everytime (South Korea). Students verify they are
students, then act pseudonymously.

Default language **Azerbaijani**, with Russian and English as first-class
alternates. All UI copy is Azerbaijani first.

## Where things are

    /Users/macbook/kiksu          npm workspaces, git repo, 49 commits
      apps/api                    NestJS + TypeScript strict
      apps/mobile                 Expo SDK 54 + Expo Router (drawer)
      apps/scraper                work.az vacancy scraper
      packages/db                 generated Supabase types
      packages/tokens             design tokens from the design file
      supabase/migrations         22 migrations
      docs/                       the contracts — read before changing anything
      scripts/                    verification and dev tooling
      design/kiksu-mobile-screens.html   the 10 designed screens

Supabase project: **`houicgsdduzzcarxkuuo`**, region `eu-central-1` (Frankfurt).
An older empty project `htwblkemseevvhnzvwdc` in Tokyo is superseded — do not
use it.

## Running it

    ./scripts/dev-api.sh          # throwaway Postgres + migrations + seeds + API on :3000
    cd apps/mobile && npx expo start -c   # then scan the QR

`dev-api.sh` sets `DEV_AUTH_APP_USER_ID`, which makes the API serve every
authenticated route as one seeded student with **no token**. Three gates keep
it safe: `parseEnv()` refuses to boot if it is set with `NODE_ENV=production`,
there is no default, and `AuthGuard` warns loudly. The OTP for email
verification is logged behind the same gate.

## Verification — run these, they are the point

    ./scripts/verify-schema.sh        # applies the monolith, asserts 11 invariants
    ./scripts/verify-migrations.sh    # same via the 22 split migrations
    ./scripts/test-integration.sh     # stands up Postgres + seeds, runs 226 tests
    ./scripts/seed-local.sh           # seeds twice, proves idempotency

`npx vitest run` alone gives 95 unit tests; integration tests skip without
`DATABASE_URL`, which `test-integration.sh` provides.

**Run the schema before committing a migration.** Three of the four defects
that blocked the original schema from applying at all were invisible to review
and instant to catch by execution.

## The architecture that must not be broken

### Four identity layers

1. **`identity.*`** (sealed) — the link between a real student and their
   pseudonym. Reachable ONLY by the verification service, through a **second
   database pool** (`IdentitySqlProvider`) with its own credentials. The main
   pool has no grant on that schema.
2. **`public.app_user`** — the persistent pseudonym. Handles are GENERATED
   (`sakit-pərvanə-37`), never chosen, changeable every 14 days.
3. **`internal.thread_alias`** — per-thread `Anonim N`, never reused across
   threads. Authorship of anonymous content lives in `internal.post_author` /
   `comment_author` / `review_author`, NOT on the public row.
4. **`career.*`** — **now unused.** Careers became aggregation-only, so Kiksu
   collects no real names at all. Tables kept, invariant 2 still guards them.

### 11 schema invariants, enforced in CI

`scripts/schema-invariants.sql`. They are negative-tested — each one has been
verified to actually fail when violated. Highlights: client roles cannot reach
sealed schemas; no FK from `career` to `app_user`; RLS on every public table;
`public_profiles` exposes exactly six columns; no exposed table mints a
UUIDv7 primary key (a v7 id leaks its creation timestamp); the token-mint hook
role cannot reach a sealed schema and its claims projection is exactly six
columns.

### Load-bearing decisions

- **The pool is BYPASSRLS.** RLS is defence in depth; every query is
  responsible for its own campus scoping. A missing predicate is a data leak,
  not a slow query.
- **Money is integer minor units everywhere.** 25 ₼ is `2500`. Converted to
  major units exactly once, at render.
- **Exact karma is own-row only.** Cross-user surfaces show a coarse, delayed
  `contributor_level`. This closes the karma-delta oracle: polling a karma
  integer while watching the forum would link a pseudonym to a specific post.
- **Alias allocation happens in the same transaction as the content insert**,
  so a rolled-back post cannot strand an ordinal and leave a permanent gap —
  a gap says "someone opened the composer and thought better of it".
- **Times are wall-clock plus the university's IANA zone, never instants.**
  Nothing on the client constructs a `Date` from a class time.
- **Azerbaijani dotted/dotless i**: `"I".toLowerCase()` under `az-AZ` yields
  `ı`. Credentials are normalised through an explicit invariant helper.

## What is built

**API** (14 modules): onboarding (email OTP + student card), timetable (week
grid, attendance, catalogue search, class detail), today, forum (boards, feed,
threads, posts, comments, votes, saves), reviews (profiles, contribution wall,
writing), commerce (listings, creation, vacancies), chat (deal threads,
structured offers), me (profile, privacy, handle rotation), reports, admin
(verification + moderation queues), moderation (tier 1 rules), ingest.

**Mobile** (20 screens): onboarding flow, Bu gün, Cədvəl + class detail sheet,
Forum (boards → feed → thread, with composer, votes, reports), Bazar (list →
detail → chat, plus listing creation), Karyera, Profil. All ten designed
screens render real data.

**Scraper**: work.az internships, JSON-LD based, robots-compliant.

## What is NOT built

- **Supabase Auth is wired but NOT RUNNING ANYWHERE YET.** The code is
  complete on both sides: migration 0021 adds the epoch counter, the
  six-column `internal.token_claims` projection and
  `auth_hooks.custom_access_token_hook`; `DbEpochService` makes revocation
  work; the app signs in anonymously, keeps the session in a chunked
  Keychain store, and refreshes once on a 401 before retrying. Three things
  stand between that and a working sign-in, and none of them is code:
    1. **The hook is not registered** in the Supabase project's auth
       settings. That is a dashboard action. Until it happens the function
       exists and never runs, so every token is claimless and every
       authenticated request answers `token_invalid`.
    2. **Anonymous sign-in is not enabled** on the project, and has no
       captcha — which leaves unlimited auth-user creation as an open abuse
       surface once it is.
    3. **No `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`**
       is set, so every build still takes the development-bypass branch.
       That is the intended default for `dev-api.sh`, which has no GoTrue.
- **The mobile auth path has never been executed.** It typechecks and the
  iOS bundle builds, and the chunked session store has 11 tests covering
  torn writes, stale tails and the byte ceiling — but no part of the app
  has been RUN against a real Supabase project. Anonymous sign-in, the
  refresh after verification, and the onboarding redirect are all unproven
  on a device. Running the simulator needs `sudo xcode-select -s
  /Applications/Xcode.app/Contents/Developer` first.
- **No `--real-auth` dev mode.** `dev-api.sh` still stands up a throwaway
  Postgres with a stubbed `auth.users` and no GoTrue, so the real token
  path cannot be exercised locally at all.
- **No production gates on the new config.** `parseEnv()` does not yet
  reject a placeholder service-role key or a non-https `SUPABASE_URL`, and
  nothing asserts at boot that the hook is registered.
- **No Redis or `LISTEN/NOTIFY` for epoch invalidation.** `DbEpochService`
  caches in-process for 30s, so cross-instance revocation lands within 30s
  rather than the sub-second §7.4 describes. Inside the spec's stated ≤60s
  target, short of its design.
- **`graduate` and `expired` tiers are unreachable.** No graduation
  transition and no credential-expiry job exist, so no row can produce them.
  Deliberately not faked from `status` — suspension is not expiry.
- **Account sanctions do nothing.** `decideModeration` accepts `mute`,
  `suspend`, `ban` and `shadowban`, writes an audit row, and never touches
  `app_user.status`. A banned student keeps posting.
- **No mail delivery.** OTP is logged behind the dev gate only.
- **No tier 2 moderation** (LLM pass) — deferred by decision. Abuse and
  defamation are caught only by human reports.
- **No appeals.** `moderation.appeal` exists; nothing writes it. Content can be
  auto-limited with no way to contest it.
- **No right of reply on reviews** — the mitigation the legal section leans on.
- **No reviews screen.** The API is built; the class sheet links to a
  placeholder.
- **No web console** for the admin queues; a moderator needs curl.
- **No photo upload** anywhere (listings, student cards).
- **No push notifications or home-screen widget** — both need a development
  build rather than Expo Go.
- **Scraper**: no pagination, no scheduling, no run history.

## Blocking launch

**The generated-handle wordlist needs a native Azerbaijani reviewer.** 64 words
with a two-entry blocklist. Some adjective–noun pairs will read as insults or
personal names in ways a non-native check cannot catch, and a handle stays
attached to a person for 14 days.

## Decisions already made — do not relitigate

Drawer navigation (not tabs) · both platforms · Supabase in Frankfurt · karma
never readable cross-user · campus badge is an opt-in per post on national
boards only · dark mode deferred to the end · two verification routes only
(email + student card, invite codes dropped) · careers is aggregation only,
no applications or CVs · tier 2 moderation deferred.

## How this project has been worked

- **The user wants a plan before implementation** for substantial work.
- **Verify by executing, not by reading.** Every phase found defects that
  review missed: four in the schema, four in the seed, a dual-React copy, a
  silent NestJS DI break, and a scraper that parsed a nav menu as an employer.
- **Say plainly what is not built** rather than faking it. Several screens
  carry "this isn't ready yet" text on purpose.
- Commits are long and explain *why*, including what was rejected.
