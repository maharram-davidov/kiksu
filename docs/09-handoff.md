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
    ./scripts/test-integration.sh     # stands up Postgres + seeds, runs 355 tests
    ./scripts/seed-local.sh           # seeds twice; see the note below

`npx vitest run` alone gives 91 unit tests; integration tests skip without
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

**API** (15 modules): onboarding (email OTP + student card), timetable (week
grid, attendance, catalogue search, class detail), today, forum (boards, feed,
threads, posts, comments, votes, saves), reviews (profiles, contribution wall,
writing), **search (global, five corpora)**, commerce (listings, creation,
vacancies), chat (deal threads, structured offers), me (profile, privacy,
handle rotation), reports, admin (verification + moderation queues), moderation
(tier 1 rules), ingest.

**Mobile** (24 screens): onboarding flow, Bu gün, Cədvəl + class detail sheet,
Forum (boards → feed → thread, with composer, votes, reports), Bazar (list →
detail → chat, plus listing creation), Karyera, Profil, **global search**. All
ten designed screens render real data.

**Scraper**: work.az internships, JSON-LD based, robots-compliant.

## Global search — built this session

Five endpoints under `/v1/search`: `posts`, `courses`, `instructors`,
`listings`, `vacancies`. Mobile route `/search`, reached from the header
search icon on Forum and Bazar (those icons were inert placeholders until now).
32 integration tests, all executed.

Four things worth knowing before touching it:

- **Five endpoints, not one aggregate, and that is a constraint rather than a
  preference.** A combined response would carry post hits (thread alias,
  Layer 3) and listing hits (seller handle, Layer 2) in one body, which
  assertion 21 forbids and CI checks mechanically. The "all" chip fans out and
  the client merges.
- **No people corpus, ever.** T11. Handle lookup is exact-match, opt-in and
  elsewhere. The empty state says so in the UI rather than leaving the absence
  to read as an oversight.
- **The language predicate is three constant arms paired to the row's `lang`.**
  The obvious `util.tsq(util.locale_text(p.lang), $q)` makes the operand
  row-dependent and the GIN index stops serving it, turning every search into a
  sequential scan.
- **Deliberately absent:** `ts_headline` snippets (the vector is folded, so a
  highlight renders `Verilenler` where the row says `Verilənlər`); review prose
  as a corpus (the contribution wall would be bypassed by the snippet);
  server-side search history and trending (a query log keyed to a pseudonym is
  a de-anonymisation corpus — recent searches live in the device keystore and
  clearing them deletes the only copy).

Results page to the end on a single scope chip; the `all` chip is a
deliberate three-per-corpus preview and does not page, because the next page of
three interleaved result sets with unrelated relevance scales has no sensible
definition. Verified by walking the cursor chain against the running API — five
single-item pages, no duplicates, order identical to one fifty-item page.

Search shows `moderation_state in ('visible','limited')`, matching the board
feed exactly. Hiding `limited` only here would hand a shadowbanned student a
self-test. That tightening remains one decision to be taken across every read
path at once.

## The dev build — taken, and what it exposed

A **local iOS Simulator dev build** now compiles and runs: `expo prebuild` +
`expo run:ios`, 0 errors, 0 warnings, launching against Metro with live API
data. `apps/mobile/eas.json` exists with four profiles
(`development-simulator`, `development`, `preview`, `production`).

Reproducing it needs three things the repo cannot carry:

- **CocoaPods.** Installed via `brew install cocoapods` (no sudo needed).
- **A UTF-8 shell locale.** CocoaPods dies with
  `Unicode Normalization not appropriate for ASCII-8BIT` under a C locale —
  prefix the command: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild`.
- **`--ignore-scripts` on npm installs.** This environment refuses
  `--allow-scripts` in project-scoped installs, so `npx expo install <pkg>`
  fails; use `npm install <pkg> --workspace @kiksu/mobile --ignore-scripts`.

`ios/` and `android/` stay gitignored — this is Continuous Native Generation,
the native project is regenerated, never edited.

**What is still NOT done:** the build is on the **Simulator**, not on a phone.
Spine's own wording is "first dev build on your phone", and that needs an Expo
login plus Apple signing credentials. Push notifications in particular remain
unproven and cannot be proven this way at all — an iOS Simulator cannot receive
remote push. The widget, likewise, has not been written. What the dev build
actually unlocks today is that native modules now compile and link, so MMKV and
anything else native is no longer blocked.

### Expo Go was hiding two broken native dependencies

This is the part worth reading. Expo Go ships its own bundled native modules and
the JS calls those, so a wrong version in `package.json` is invisible. A dev
build compiles the module that is actually installed, and both of these turned
up in the first two minutes:

- **`expo-secure-store` was at 57.0.1 where SDK 54 wants ~15.0.8** — an entirely
  different major, from a future SDK train. This is the module holding the auth
  session. Its 11 tests never caught it because `chunked-storage.ts`
  deliberately imports nothing from Expo and runs against a fake backend, which
  is good design and, here, a blind spot.
- **`expo-font` was missing as a direct dependency** and resolved transitively to
  57.0.1 through `@expo/vector-icons`, so it never autolinked. The dev build
  failed instantly with `Cannot find native module 'ExpoFontLoader'`, which also
  produced a misleading `_layout.tsx is missing the required default export`
  warning — a knock-on, because the layout imports `HeaderIcon`, which throws at
  module scope.

Both pinned to the SDK 54 train (`~15.0.8`, `~14.0.12`) from
`node_modules/expo/bundledNativeModules.json`, which is the authority. Note that
`@expo/vector-icons@15.1.1` still drags its own `expo-font@57.0.1` into the root
`node_modules`; autolinking resolves from the app directory and picks the correct
14.0.12, confirmed in `ios/Podfile.lock` (`ExpoFont (14.0.12)`). Worth a look if
anything font-related behaves oddly.

Also caught by running it: the search screen's scope chips rendered as
full-height columns, because a horizontal `ScrollView` in a flex column stretches
unless given `flexGrow: 0`. Nothing in a type check or a unit test sees that.

## Defects found by execution this session

All four were found by running things, not by reading them.

1. **The test harness could not exercise Azerbaijani folding at all.** All four
   scripts ran `initdb --locale=C`. Under C ctype `lower()` only touches ASCII,
   so `lower('Ə')` is `'Ə'` and `util.fold_text` — which translates the
   *lowercase* set `əğıöşüçё` — left every uppercase Azerbaijani letter
   unfolded. The stored `name_folded` for `Nigar Əliyeva` was
   `nigar Əliyeva`, and a search for `Eliyeva` returned nothing. Now
   `--lc-collate=C --lc-ctype=C.UTF-8`: collation stays byte-deterministic so
   ordering assertions do not depend on the machine, while ctype folds
   correctly. Fixed in all four scripts. **Supabase was never affected** — it
   runs a UTF-8 ctype — so this was a hole in the tests, not in the product.
2. **`numeric field overflow` on every date and price sort.** The keyset
   projected each sort into `numeric(12,8)`, which holds four integer digits; an
   epoch needs twelve. Relevance sorts passed because a rank is below 1, so the
   bug only appeared once a non-relevance sort was actually run. Now
   `numeric(24,8)`. `coalesce(deadline, 'infinity'::date)` was a second bug in
   the same line: an infinite epoch cannot cast to numeric.
3. **`validation_failed` came back as two different statuses.** The exception
   filter's ZodError branch hardcoded `400` while `HTTP_STATUS_BY_CODE` and
   `05-api-conventions.md` §3 both say `422` — so the same code was 400 from a
   `schema.parse()` and 422 from an explicit throw. Pre-existing, affecting every
   zod-validated endpoint. The filter now reads its own table, and the test that
   asserted 400 was encoding the bug.
4. **Three cursor tests were passing without asserting anything.** They
   early-returned when there was no second page, and the content seed holds six
   posts of which exactly one matches `imtahan`, so `next_cursor` was always
   null. They also asserted with `.rejects.toThrow(/cursor_invalid/)`, which
   never matches: `AppError` keeps the student-facing message and the code as
   two separate strings by construction, so `.message` is always `"App Error"`.
   Now they build their own fixtures, assert on `.code`, and fail if the fixture
   is too small to produce a cursor.

Also corrected: `05-openapi.yaml` still described the access token as **RS256**.
The handoff, the service comment and `05-api-conventions.md` were fixed when
ES256 was discovered; the OpenAPI document was missed.

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
- **Shadowban hides less than the name implies.** The other sanctions are
  real now: mute, suspend, ban and unban write `app_user.status` and every
  write path checks it via `SanctionsService`. Shadowban writes the status and
  limits the author's new content at write time, which avoids putting
  `internal.post_author` into every feed query — that join is what invariant 8
  exists to prevent. But `limited` content still appears in the forum feed
  (`moderation_state in ('visible','limited')`), so a shadowbanned student is
  currently hidden only where `limited` is actually hidden, which is chat.
  Tightening that is a read-path decision nobody has taken yet.
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
- **Two course-search implementations over one corpus.** `/v1/search/courses`
  (ratings, paginated) and `GET /v1/timetable/courses` (instructor names, for
  the course picker) query `ref.course` with the same scope and the same three
  fold predicates. Neither has a client consumer conflict, but **a change to the
  fold rules must be made in both** or the same query behaves differently
  depending on which screen the student came from. Cross-referenced in both
  files. `docs/05-openapi.yaml` also still documents a `/catalogue/courses` that
  was never implemented at that path.
- **No photo upload** anywhere (listings, student cards).
- **No push notifications or home-screen widget.** The dev build that used to
  block both now exists, but neither is unblocked by it in the way the old note
  implied: an iOS Simulator **cannot receive remote push at all**, so proving
  push needs a build on a physical device (Expo login + Apple signing), and the
  widget is unwritten native work regardless. What the dev build did unblock is
  MMKV and any other native module, which now compile and link.
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
