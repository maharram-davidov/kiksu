# @kiksu/api

The server layer every Kiksu client write, and every identity-sensitive read, passes
through — per `docs/00-project-brief.md` and `docs/05-api-conventions.md`. Read the
conventions doc first; this package implements its cross-cutting rules and exactly one
worked-example endpoint, `GET /v1/bootstrap`.

**Scope of this package right now.** This is infrastructure scaffolding, not a
finished API. Onboarding, timetable, forum and reviews endpoints are other agents'
work and are deliberately absent. What's here: the auth guard, the error taxonomy, the
keyset-cursor signer, rate limiting, idempotency, config, health, and `bootstrap`.

## Running it

From the **repo root** (this is an npm workspace, `@kiksu/api`):

```bash
npm install                              # installs the whole workspace
cp apps/api/.env.example apps/api/.env   # fill in real values — see below
npm run typecheck --workspace @kiksu/api # tsc --noEmit
npm test --workspace @kiksu/api          # vitest run
npm run dev --workspace @kiksu/api       # dev server with reload, :3000 by default
```

Or from `apps/api` directly: `npm run dev`, `npm run build && npm start`, `npm test`,
`npm run typecheck`.

**Minimum `.env` to boot locally** (see `.env.example` for the full, documented list):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CURSOR_HMAC_SECRET` (32+ chars — `openssl
rand -hex 32`), `IOS_STORE_URL`, `ANDROID_STORE_URL`. Boot fails fast with a readable
error listing exactly what's missing/malformed (`src/config/env.schema.ts`) — this is
deliberate, see §7 of the conventions doc's rationale for server-authored config.

**Verified before calling this done** (repeat these to confirm):
```bash
npm install                                        # from repo root — succeeds
cd apps/api && npx tsc --noEmit                     # clean
cd apps/api && npx vitest run                       # 25/25 passing
cd apps/api && npm run build && npm start           # boots; GET /health and GET /v1/bootstrap both 200
```
`npm run dev` (the `ts-node`-based watch script) was also verified end to end against
a live process — see the note on `tsx` under **Why `ts-node`, not `tsx`** below if
you're tempted to switch it.

## What's implemented

| Conventions doc § | Where |
|---|---|
| §1.3 `GET /v1/bootstrap` | `src/modules/bootstrap/` — the one real, complete endpoint |
| §2.1–2.4 Auth guard, JWT verification, `app_metadata`-only trust, epoch revocation | `src/common/auth/` |
| §2.3 The `user_metadata` trap | `src/common/auth/auth.guard.ts`, `claims.ts` — see below |
| §3 Error taxonomy, envelope, catalogue, uniform codes | `src/common/errors/` |
| §3.2 az/ru/en localisation | `src/common/locale/`, `src/common/errors/error-catalogue.ts` |
| §4 Signed keyset cursors, 60s quantisation | `src/common/pagination/` |
| §5 Rate limiting, headers, tier/age scaling | `src/common/rate-limit/` |
| §6 Idempotency for writes | `src/common/idempotency/` |
| Config, fail-fast env validation | `src/config/` |
| Health (infra, unversioned) | `src/modules/health/` |

### The auth guard and the `user_metadata` trap (§2.3)

`AuthGuard` (`src/common/auth/auth.guard.ts`) is registered globally
(`APP_GUARD` in `app.module.ts`) — **every route requires a verified caller unless
explicitly marked `@Public()`**, fail-closed by default. It reads the trusted claim
allowlist (`sub` top-level; `app_user_id`, `tier`, `role`, `univ_id`, `epoch`, `sid`
from `app_metadata` only — §2.2/identity spec §7.1) and populates `req.kiksu`.

Per §2.3, a request whose `user_metadata` contains an allowlisted-looking key
(`tier`, `role`, `app_user_id`, `univ_id`, `epoch`, `verification_status`, `karma`,
`contributor_level`) is **served normally with those values ignored**, and the
occurrence is recorded via `SecurityMetricsService` — never rejected, because
rejecting would disclose which key names are checked. This is exercised directly in
`test/auth.guard.spec.ts`.

`EpochService` and `AccountAgeService` are **stubbed** (`NoopEpochService`,
`NoopAccountAgeService`) — see **Known gaps** below before treating auth as
production-ready.

### The error layer (§3)

`AppError` (`src/common/errors/app-error.ts`) is the one exception type a route should
throw — `throw new AppError("tier_insufficient")`. `KiksuExceptionFilter` is the only
place a Nest exception becomes an HTTP response, so the envelope shape
(`code`/`message`/`message_key`/`action`/`action_label`/`details`/`request_id`) can't
drift between call sites. It also catches anything else (a stock `HttpException`, a
truly unexpected error) and normalises it onto the closed code set — an unrecognised
error becomes a bare `internal_error` with the real cause logged server-side only,
never in the response (§3.3: "None of them ever carries a detail describing the
failing dependency").

The message catalogue (`error-catalogue.ts`) has an az/ru/en entry for all 61 codes;
`assertCatalogueComplete()` is a cheap completeness check, run in
`test/error-filter.spec.ts`. **The ru/en translations were written by an engineer, not
a native-speaker localiser** — get a native-speaker pass before treating this copy as
final; `az` is closest to the doc's own quoted examples (three catalogue entries reuse
the doc's exact wording).

### Signed keyset cursors (§4)

`CursorService` (`src/common/pagination/cursor.service.ts`) implements the exact
payload shape from §4.3 (`v`/`q`/`k`/`d`/`x`), HMAC-SHA256 signed and base64url
encoded, with `fingerprintQuery()` for binding a cursor to its endpoint + sort/filter
params and `quantiseTimestamp()` for the forum feed's 60s bucket. `verify()` collapses
every failure mode (bad signature, malformed payload, wrong `v`, expired, wrong query
fingerprint) into one `cursor_invalid` — deliberately undifferentiated, same reasoning
as the doc's uniform-response codes. Covered by `test/cursor.service.spec.ts`,
including a tampered-payload-with-original-signature case.

### Rate limiting (§5)

`rate-limit.buckets.ts` mirrors §5.2's table data (base limits, tier/age-scaling
formula). `RateLimitGuard` + `@RateLimit("forum.post.create")` drive the "product
surface" buckets that fit the generic single-limit/single-window shape. The
**onboarding buckets and `forum.alias_preview`** are multi-window or distinct-value
shapes (e.g. "5 distinct addresses/device/day") that don't reduce to that — they're
documented as data in `rate-limit.buckets.ts` with a note on each, and an endpoint
implementer should compose `RateLimiterService.consumeFixed()` calls directly rather
than expect the decorator to cover them.

### Idempotency (§6)

`IdempotencyMiddleware` is genuine Express/Nest middleware (not a guard/interceptor)
because replaying a stored response needs the *actual* final status/body regardless of
how a handler produces it (`@HttpCode`, plain return, or `@Res()`) — it hooks
`res.json` directly, which is the only place that's true. It's opt-in per route via
`consumer.apply(IdempotencyMiddleware).forRoutes(...)` in the module that owns the
write endpoint (see the doc comment in `idempotency.middleware.ts` for the exact
snippet) — not global, since `PUT`/`DELETE`/`GET` never take a key (§6.1).

One documented implementation choice beyond the letter of the spec: a handler that
fails with a 5xx has its idempotency record **released, not cached** — a permanent 4xx
IS cached (deterministic replay is correct and cheap), but caching a transient server
error forever under a key would brick a legitimate retry. See the doc comment on
`IdempotencyStore.release()`.

§6.3's three-mechanism stack for the thread-alias case: this middleware is mechanism
(1) only. Mechanisms (2) (the alias map's composite primary key) and (3) (allocating
inside the same transaction as the content insert) belong to whoever builds the forum
endpoints and are out of this package's scope.

### Why `ts-node`, not `tsx`, for `npm run dev`

`tsx` (esbuild) does not reliably emit the `design:paramtypes` decorator metadata
Nest's DI container reads. Concretely: with `tsx watch`, `AuthGuard`'s constructor
injection failed — `this.reflector` came back `undefined` at request time, with no
error at boot — while a `tsc`-compiled build and `node dist/main.js` worked correctly
with the identical source. This is a known esbuild/Nest interaction, not a bug in this
code (confirmed by building with `tsc` and running the compiled output — see
**Verified before calling this done** above). `dev` therefore uses
`node --watch -r ts-node/register src/main.ts`, which runs the real TypeScript
compiler and reproduces `tsc`'s metadata emission exactly.

## Wiring up a new endpoint

1. Controller/service under `src/modules/<name>/`, its own `<name>.module.ts` imported
   into `app.module.ts`.
2. Every route requires auth by default. Read the caller with `@CurrentUser()`
   (`src/common/auth/current-user.decorator.ts`) — never from a body/query param
   (§2.3: "the caller is always the token"). Mark a route `@Public()` only if the
   OpenAPI contract says `security: []`.
3. Throw `AppError(code, { details?, action? })` for every failure — never a bare
   `throw new Error(...)` or a raw `HttpException`, or the catalogue/envelope
   guarantees don't apply.
4. Collections: keyset-paginate with `CursorService`, return `PageInfo` from
   `src/common/pagination/page-info.ts`, no `total_count`.
5. Writes: `PUT`/`DELETE` take no key. A creating/consuming `POST` needs
   `IdempotencyMiddleware` wired via `configure()` in that module.
6. Apply `@RateLimit("bucket.name")` for anything in `SCALED_BUCKETS`
   (`rate-limit.buckets.ts`); add a new bucket there (data) if the endpoint needs one
   not yet listed, per §5.2's own rule that new buckets are an additive change.
7. Before merging: re-read conventions doc §9's checklist, especially §8's
   field-by-field layer-linking prohibitions — nothing here enforces those
   automatically yet (see Known gaps).

## Known gaps — not identity semantics, just unbuilt plumbing

These are intentional scaffold seams (abstract classes / swappable stores with a
working-but-wrong-for-production default), not open design questions. Each has a
`SECURITY` or correctness warning in its own file:

- **`NoopEpochService`** (`common/auth/epoch.service.ts`) always reports the token's
  own epoch, i.e. never stale. **Token revocation does not actually work yet** — a
  ban/suspension will not invalidate an already-issued access token until this is
  replaced with the Redis + Postgres `LISTEN/NOTIFY`-backed cache identity spec §7.4
  describes.
- **`NoopAccountAgeService`** (`common/rate-limit/account-age.service.ts`) reports
  every account as brand-new (age 0), which is the fail-*safe* direction (strictest
  rate-limit bracket) but means age-based scaling doesn't reflect reality yet.
- **`InMemoryRateLimitStore`** and **`InMemoryIdempotencyStore`** are correct for a
  single process only. A multi-instance deploy needs the Redis-backed implementations
  (`RATE_LIMIT_STORE=redis` / `IDEMPOTENCY_STORE=redis` in `.env` — the env var exists,
  the Redis-backed class does not yet).
- **§8's response-schema allowlist / paired-field CI assertions** (conventions doc
  §8.3) are not implemented here — nothing in this package currently fails a build if
  a future endpoint's response schema puts an alias field and a handle field in the
  same body. That CI check needs to exist before endpoints ship.
- No global request-validation pipe: `bootstrap` takes no input, so there's nothing to
  validate yet. The first endpoint with a request body should add its own validation
  (zod, or `class-validator`/`class-transformer` — neither is currently a dependency)
  and turn a failure into `AppError("validation_failed", { details: { fields } })`.

## Open questions

Per the project brief's rule: flagged here rather than guessed at. Items marked
**identity semantics** need the Identity Architect or product, not this package, to
resolve.

1. **Rate-limit tier for `graduate`/`expired` callers — identity semantics-adjacent.**
   §5.2's tier-scaling table only has columns for `provisional`/`email`/`card`, but
   identity spec §2.0's tier machine also has `graduate` and `expired`. This scaffold
   maps both to `email`'s limits (`rate-limit.guard.ts`'s `toRateLimitTier()`) as the
   closest defined tier, purely so the guard has *some* defined behaviour — this is a
   scaffold default, not a considered product decision, and should be revisited
   alongside identity spec open question 2 (graduate tier's permission set generally).

2. **Device-attestation-id transport for onboarding rate-limit keying.** §5.2 lists
   "device attestation id (onboarding)" as the second-preference rate-limit key, but
   no header or mechanism carries it anywhere in the conventions doc — and §1.2 is
   explicit that `X-Kiksu-Client` carries **no** device identifier. Whatever carries
   Play Integrity / App Attest attestation (mentioned in identity spec T13) needs a
   named transport before the onboarding buckets in `rate-limit.buckets.ts`
   (`auth.invite.redeem.device`, `auth.otp.send.device_daily_addresses`) can be keyed
   correctly. This scaffold's `RateLimitGuard` only derives `app_user_id`/IP for that
   reason — device keying for anonymous onboarding flows is left to whoever builds
   those endpoints.

3. **`client_version_unsupported`'s frozen envelope — resolved a doc-internal
   ambiguity, flagging the resolution for review.** §1.5 point 5 shows the frozen
   shape as `{"error":{"code":"...","message":"...","store_url":"..."}}` — apparently
   *only* those three fields, omitting `message_key`/`action`/`action_label`/
   `details`/`request_id`. But `components.schemas.Error` in `05-openapi.yaml` models
   `store_url` as one more optional field on the *same* full envelope used everywhere
   else. This implementation follows the OpenAPI schema (full envelope + `store_url`),
   reading §1.5's JSON as an abbreviated illustration of the fields that are
   guaranteed never to change, not an exhaustive alternate shape. If the intent was
   genuinely a stripped-down three-field body (e.g. because some `/v1`-era client
   predates `message_key` and shouldn't be handed unfamiliar fields), that's a
   different implementation and should be confirmed before `client_version_unsupported`
   ships for real.

4. **Idempotency and 5xx responses — not addressed by §6, flagging the choice made.**
   §6.2 says a replay "returns the stored status and the stored body" without carving
   out server errors. This scaffold releases (doesn't cache) a 5xx outcome so a retry
   after a transient failure gets a fresh attempt, on the reasoning that freezing a
   503 under a key forever can't be the intent — see the doc comment on
   `IdempotencyStore.release()`. Worth an explicit confirmation rather than treating
   this scaffold's interpretation as settled.

5. **"Account age" for §5.2's `age_multiplier` — not defined precisely.** The
   conventions doc says "account age" without specifying the epoch it's measured from:
   `app_user` row creation, first verification grant, or something else. This scaffold
   assumes "since the `app_user` row was created" (`AccountAgeService.getAccountAgeMs`),
   which matters specifically for the `provisional` (invite) tier's 7-day funnel —
   whether the age clock starts at invite redemption or would restart on upgrade to
   `email`/`card` is unaddressed either way.

Carried forward from the conventions doc's own `## Open questions` (not re-litigated
here, but relevant to anyone building on this scaffold): the UUIDv7-internal/
UUIDv4-external id split (§01-schema-notes.md resolves this one already — externally
exposed tables use v4), and the alias-preview hold TTL (5 vs 15 vs 30 minutes) — this
package doesn't hardcode either, but whichever service issues alias previews will need
the number settled.

## Running it

    ./scripts/dev-api.sh

One command. It stands up a throwaway PostgreSQL, applies every migration and
both seeds, writes `apps/api/.env` with development values, and runs the API in
watch mode on :3000. Ctrl+C removes the database. Nothing touches the remote
Supabase project.

`npm start` runs the COMPILED output and now builds first — previously it failed
with a bare `MODULE_NOT_FOUND` against a `dist/` that had never been built. Use
`npm run dev` for watch mode against an environment you have set up yourself.

`.env` is read by `dotenv`, imported as the very first line of `main.ts`.
Ordering matters: config validation runs at module initialisation, so anything
imported above it would see an empty `process.env` and fail fast before the file
was read. Real environment variables always win over the file.

### Development environment caveat

`scripts/dev-api.sh` points `DATABASE_URL_IDENTITY` at the same database as
`DATABASE_URL`, because there are no separate roles locally. That collapses the
Layer 1 boundary. `IdentitySqlProvider` warns about it and refuses outright in
production, and the boundary itself is verified by invariant 1 against the real
grants — not by the development setup.

## The development auth bypass

`scripts/dev-api.sh` sets `DEV_AUTH_APP_USER_ID`, which makes the API serve
every authenticated route as one seeded student with no token at all.

It exists because the API verifies tokens against a Supabase JWKS endpoint, and
there is no such endpoint locally — without it, every authenticated route is
unreachable and no screen can be built or demonstrated against real data.

**Three independent gates, any one of which disables it:**

1. `parseEnv()` **refuses to boot** if the variable is set while
   `NODE_ENV=production`. A stray value in a real deployment crashes on startup
   rather than silently accepting unauthenticated traffic as a real user.
2. There is no default. An operator has to name a specific user id.
3. `AuthGuard` logs a loud warning on every boot where it is active.

A bypass that fails open is worse than no bypass. Two tests cover it: that
production config parses fine without it and throws with it, and that the
context it builds uses the **email** tier rather than `card` — developing
against the most privileged identity hides tier-gating bugs, which this project
has already shipped once.
