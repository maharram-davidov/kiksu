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
      apps/admin                  internal web console (Vite + React)
      apps/scraper                work.az vacancy scraper
      packages/db                 generated Supabase types
      packages/tokens             design tokens from the design file
      supabase/migrations         23 migrations
      docs/                       the contracts — read before changing anything
      scripts/                    verification and dev tooling
      design/kiksu-mobile-screens.html   the 10 designed screens

Supabase project: **`houicgsdduzzcarxkuuo`**, region `eu-central-1` (Frankfurt).
All 23 migrations are applied there and all 11 invariants pass against it. The
schema is current; **nothing else is** — see below.
An older empty project `htwblkemseevvhnzvwdc` in Tokyo is superseded — do not
use it.

## Running it

    ./scripts/dev-api.sh          # throwaway Postgres + migrations + seeds + API on :3000
    ./scripts/dev-api.sh --staff  # ...and make that identity a moderator
    npm run dev --workspace @kiksu/admin   # the console on :5174
    cd apps/mobile && npx expo start -c   # then scan the QR

`dev-api.sh` sets `DEV_AUTH_APP_USER_ID`, which makes the API serve every
authenticated route as one seeded student with **no token**. Three gates keep
it safe: `parseEnv()` refuses to boot if it is set with `NODE_ENV=production`,
there is no default, and `AuthGuard` warns loudly. The OTP for email
verification is logged behind the same gate.

## Verification — run these, they are the point

    ./scripts/verify-schema.sh        # applies the monolith, asserts 11 invariants
    ./scripts/verify-migrations.sh    # same via the 22 split migrations
    ./scripts/test-integration.sh     # stands up Postgres + seeds, runs 304 tests
    ./scripts/seed-local.sh           # seeds twice; see the note below

`npx vitest run` alone gives 119 unit tests; integration tests skip without
`DATABASE_URL`, which `test-integration.sh` provides.

`seed-local.sh` runs every seed twice. `seed.sql` (reference data) is
idempotent and holds steady. **`seed-content.sql` and `seed-commerce.sql` are
not** — posts, comments, reviews, listings and vacancies double on the second
pass. Pre-existing, surfaced rather than hidden; the identity and moderation
blocks added for the admin console are explicitly guarded and do hold.

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

**Mobile** (23 screens): onboarding flow, Bu gün, Cədvəl + class detail sheet,
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
    1. **The hook is registered and PROVEN** (18 Aug). Verified end to end
       against the live project, not inferred: anonymous sign-in, then an
       `app_user` created for that subject, then a refresh — and the new
       token carried all six claims in `app_metadata`, with `tier` correctly
       mapped `card_verified → card` and `sid` equal to the token's own
       `session_id`. Bumping `internal.auth_epoch` then produced a token
       carrying the higher epoch, so revocation works live too. The test rows
       were removed afterwards; the project is back to zero.
    2. **The tokens are ES256, not RS256.** Found by verifying a real token:
       the header says ES256 and the JWKS publishes one EC key. The service's
       doc comment and `docs/05-api-conventions.md` both said RS256, and the
       e2e suite only ever minted RS256 — so it was proving the guard against
       an algorithm the product does not use. Both are corrected and the suite
       now covers ES256. **`JwtVerifierService` deliberately does not pin an
       algorithm**: jose resolves the key by `kid` from the published set, so
       a Supabase key rotation or curve change is a non-event. Pinning would
       turn that routine change into every token being rejected at once.
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
- **Mail needs SMTP configured.** `MailerService` sends over plain SMTP
  (`SMTP_URL`, `MAIL_FROM`); with neither set it captures the message in
  memory instead, which is the local path. `parseEnv()` refuses to boot in
  production without them. Deliverability to `.edu.az` university mail servers
  is the real unknown and is an empirical question, which is why this is a URL
  rather than a vendor SDK.

  **Resend is connected** and a `kiksu.site` sending domain exists (eu-west-1,
  open and click tracking OFF — the code template deliberately carries no
  tracking pixel and no link, and leaving tracking on would have Resend inject
  both). Resend speaks plain SMTP, so `SMTP_URL=smtp://resend:<api-key>@smtp.resend.com:587`
  works against the existing mailer with no code change.

  The domain changed from `kiksu.az` to **`kiksu.site`** by product decision.
  That renamed more than the sender: `docs/05-api-conventions.md` documents the
  API base URL and the deprecation-link host, and the scraper's User-Agent
  advertises `+https://kiksu.site/bot` and `contact@kiksu.site` to work.az.
  **That bot page does not exist yet** — a crawler identifying itself with a
  URL that 404s is exactly what gets a scraper blocked, so it needs to be real
  before the scraper runs against work.az again. The synthetic auth address
  `<uuid>@users.kiksu.invalid` is deliberately unchanged: `.invalid` is a
  reserved, unroutable TLD, and that is the point of it.

  **The domain is VERIFIED and a real message was delivered** to
  `mdavidov@std.beu.edu.az` (BMU) on 18 Aug — Resend reports `delivered`, so
  a real Azerbaijani university mail server accepted mail from `kiksu.site`.
  The body was rendered by the actual `verificationCodeMail` template, so what
  arrived is byte-for-byte what onboarding would send.

  Read that result precisely, because it is narrower than "mail works":

  - **It landed in the INBOX**, confirmed by opening the mailbox — not just
    accepted by the server. That is the deliverability question answered for
    BMU (`std.beu.edu.az`) with no DMARC record beyond the SPF and DKIM Resend
    requires. The other three campuses are untested; BDU, ADA and UNEC each
    run their own mail and can differ.
  - **The SMTP transport was NOT exercised.** Every SMTP port (587, 465, 2587,
    2465) is blocked outbound from the development machine, so the send went
    over Resend's HTTPS API instead. `SmtpMailerService` — the code path
    production uses — has still never made a successful connection. It was
    observed failing correctly: an SMTP auth failure surfaced as
    `service_unavailable`, which is the honest-failure behaviour, proven
    against a real failure rather than a stub.
  - No `SMTP_URL` is set in any environment, so onboarding still captures
    rather than sends everywhere.

- **`auth.otp.send.device_daily_addresses` is not enforced.** The other three
  OTP send caps are (60s cooldown, 3/hour, 10/day, keyed on the credential
  HMAC so no address reaches the limiter store). The fourth is a
  set-cardinality limit needing a device identifier the product does not have.
- **No `--real-auth` dev mode.** `dev-api.sh` still stands up a throwaway
  Postgres with a stubbed `auth.users` and no GoTrue, so the real token
  path cannot be exercised locally at all. Not attempted: it needs
  `supabase start`, and neither Docker nor the Supabase CLI is installed on
  this machine, so the script could not have been run once before being
  committed.
- **No Redis or `LISTEN/NOTIFY` for epoch invalidation.** `DbEpochService`
  caches in-process for 30s, so cross-instance revocation lands within 30s
  rather than the sub-second §7.4 describes. Inside the spec's stated ≤60s
  target, short of its design.
- **`graduate` and `expired` tiers are unreachable.** No graduation
  transition and no credential-expiry job exist, so no row can produce them.
  Deliberately not faked from `status` — suspension is not expiry.
- **Account sanctions do nothing.** `decideModeration` accepts `mute`,
  `suspend`, `ban` and `shadowban`, writes an audit row, and never touches
  `app_user.status`. A banned student keeps posting. The console offers these
  actions because the API accepts them, in a box that says so. Appeals do not
  depend on this: an action is recorded either way, so it is contestable
  either way, and when sanctions become real they inherit a working appeal
  path.
- **Appeals cover CONTENT decisions only in practice.** The path itself is
  kind-agnostic, but the only decisions that currently change what a student
  sees are `limit` (automod) and `remove_content`. There is no notification
  when either happens — a student finds out by opening Profil → Məzmunum.
- **The console is 3 of the 10 AD screens.** AD-01 moderation, AD-02
  verification and AD-03 appeals. Not built: sanctions/appeals, catalogue editor, university
  onboarding, employer accounts, broadcast, analytics, feature flags, and the
  Layer 1 legal-request log (AD-10) — `identity.access_log` now has real rows
  and nothing reads them back.
- **Card images need a real Supabase Storage bucket.** The endpoint mints a
  60s signed URL against `SUPABASE_EVIDENCE_BUCKET`; locally there is no
  storage, so the image fails to load. The access-log write happens first
  regardless, which is the property that matters and is tested both ways.
- **No tier 2 moderation** (LLM pass) — deferred by decision. Abuse and
  defamation are caught only by human reports.
- **No right of reply on reviews** — the mitigation the legal section leans on.
- **Reviews: 4 of the 11 RV screens.** Built: the professor profile, the
  written-review list with its course filter, the composer, and the
  contribution wall — the whole flow the class sheet links into. NOT built,
  each because the API does not exist: reviews home/search, course profile,
  grade distribution, syllabus and materials, "my reviews". Two new
  endpoints came with this (`/reviews/tags`, `/reviews/reviewable`); the
  latter exists because the instructor profile only lists courses that
  already HAVE reviews, so it cannot drive a first review.
- **Azerbaijani copy in the reviews block is partly unreviewed.** Strings
  present in the design are verbatim; about sixteen are newly written and
  listed by name in `az.json`'s `_meta`. Same native reviewer as the handle
  wordlist.
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
