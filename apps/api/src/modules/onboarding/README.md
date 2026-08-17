# Onboarding module

**Status: identity primitives only.** The endpoints and the verification state
machine are not built yet. What is here is the security-critical core they will
depend on, done first and tested hard, because these are the pieces that cannot
be quietly fixed later.

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
