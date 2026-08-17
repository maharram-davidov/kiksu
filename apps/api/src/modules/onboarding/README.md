# Onboarding module

University picker and the university-email verification route, plus the
identity primitives underneath them.

| Endpoint | |
|---|---|
| `GET /v1/onboarding/universities` | Public. The picker, with the sample address the design shows |
| `POST /v1/onboarding/verify/email/start` | Public. Sends a 6-digit code |
| `POST /v1/onboarding/verify/email/confirm` | Confirms and provisions the pseudonym |

**Not built:** the student-card route, invite codes, re-verification and the
graduate tier. The card route needs the private evidence bucket and a human
review queue; the schema has the columns (`evidence_path`, `evidence_sha256`,
`evidence_purge_at`, `sla_due_at`) and nothing writes them yet.

## Two connections, on purpose

Verification is the only module that touches `identity.*`, and it does so
through a **separate pool** (`IdentitySqlProvider`) authenticating as
`kiksu_identity_svc`. The main pool has no grant on that schema and must never
gain one — invariant 1 fails the build if it does.

That split is what makes the boundary real rather than aspirational: a SQL
injection or a careless join anywhere in forum or timetable code cannot reach
identity data, because the connection those modules hold is not permitted to
see it. `DATABASE_URL_IDENTITY` must therefore be a genuinely distinct
credential; the provider refuses to boot in production if it equals
`DATABASE_URL`, and warns loudly elsewhere.

## What the flow does and does not reveal

- **Start is uninformative about membership.** The response is identical
  whether or not the address already has an account. Differentiating would make
  this an oracle for "is this classmate on Kiksu", which is a de-anonymisation
  primitive.
- **An unrecognised domain IS reported**, because the student needs to know
  their university is not onboarded yet, and a domain is not personal data.
- **Confirm failures are undifferentiated.** Wrong code, expired code and no
  attempt all return the same error; distinguishing them hands an attacker a
  search signal. Five failures expire the attempt.
- **The code is never stored**, only its HMAC, and it is never returned in a
  response. A test asserts the stored value does not contain the code.

## The sealed link

`public.app_user` records nothing about which subject it came from. The mapping
lives only in `identity.app_user_link`, readable only by this service. A test
asserts both halves: no `subject_id` column on the public row, and a link row
that does exist inside `identity`.

## Not done

**No mail delivery.** `startEmailVerification` creates the attempt and stores
the challenge, but nothing sends it. The code is exposed on the service as
`pendingCodeForDevelopment` purely so the flow is testable; that field must not
survive into production, and wiring a provider is the next step for this module.

## `credential-hash.ts` — one verified person, one account

A **keyed** hash (HMAC-SHA256 under a server-held pepper), not a salted one.
The original brief said "salted credential hash"; that cannot work, because a
per-row random salt makes the same credential hash differently every time and
uniqueness — the whole point of the column — becomes unenforceable. A keyed
hash is deterministic while still resisting offline enumeration by anyone who
steals the table.

Digests carry a `v1:` prefix so the pepper can be rotated by writing `v2:`
alongside rather than invalidating every account on one day.

### The Azerbaijani dotted/dotless i

Azerbaijani treats **I/ı** and **İ/i** as four distinct letters. Under an `az`
locale, `"I".toLowerCase()` returns `"ı"`, not `"i"`.

Left alone, a student verifying on a phone set to Azerbaijani produces a
different digest than the same student on an English phone, or than the server.
It fails in both directions and both are bad: one person ends up with two
accounts, and two different credentials can collide onto one digest and lock a
real student out.

`normaliseCredential()` folds `İ` and `ı` to plain `i` explicitly and then uses
the invariant `toLowerCase()`, never `toLocaleLowerCase()`. Six tests cover it,
including one that demonstrates the hazard directly so the reason survives a
future refactor.

## `handle-generator.ts` — pseudonyms are generated, never chosen

`sakit-pərvanə-37`, `quru-püstə-19`. A chosen handle is an identity people
reuse across services; generating it means the pseudonym carries nothing the
user brought with them. Words are mundane on purpose — a handle that sounds
chosen invites people to treat it as an identity worth keeping.

32 adjectives x 32 nouns x 90 numbers = 92,160 combinations. Collisions retry
rather than appending a discriminator, since `sakit-pərvanə-37-2` would
advertise that `sakit-pərvanə-37` exists. Exhaustion throws rather than
degrading to a sequential suffix, which would leak the user count.

## Open questions

1. **The wordlist needs a native Azerbaijani reviewer before launch.** 64 words
   and a 2-entry blocklist is not enough. Some adjective-noun pairs will read as
   insults, slurs or personal names in ways a non-native check cannot catch, and
   a handle is attached to a person for 14 days at a time.
2. **Pepper storage and rotation.** The pepper must live in a KMS or secret
   manager, never in the database beside the digests and never in the repo. The
   rotation procedure (dual-write `v1:`/`v2:`, backfill, retire) is not written.
3. **Card and phone credentials** reuse the same hashing but their
   normalisation is not specified — card numbers may have formatting variants
   across universities.
4. **Namespace headroom.** 92k combinations is comfortable for one campus and
   tight nationally. Adding words grows it multiplicatively; that decision
   should be made before launch, not after handles start colliding.
