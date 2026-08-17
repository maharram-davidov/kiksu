# Forum module

Read endpoints for boards, feeds and threads.

| Endpoint | Purpose |
|---|---|
| `GET /v1/forum/boards` | Caller's campus boards plus the national tier |
| `GET /v1/forum/boards/:slug/posts` | Board feed, keyset-paginated |
| `GET /v1/forum/posts/:id` | Thread with comments and the caller's next alias |

## Authorship is unavailable here by construction

These queries never join `internal.post_author` or `internal.comment_author`.
They *cannot*: that schema has no grant to this connection's role. Anonymity is
enforced by invariant 1 rather than by anyone remembering not to write the join.

`forum.types.ts` states the corresponding rule for responses: no shape may carry
a handle, an app_user id, or anything that lets a reader join two posts to the
same person. An author is an ordinal plus a coarse tier and nothing else.

Four tests enforce this rather than trusting it — they serialise whole responses
and assert that no seeded handle and no `app_user.id` appears anywhere in the
JSON, for both the thread and the feed, plus a check that the author object has
exactly the keys `alias_number`, `is_op`, `tier`.

## The composer's next alias

`your_next_alias` is the design's "ANONİM 5 KİMİ YAZ". It reserves with a TTL
rather than consuming: showing an ordinal the caller might not use would leave a
permanent gap, and a permanent gap announces that someone opened the composer
and thought better of it (identity spec P3). Re-opening the thread returns the
same ordinal — tested.

## Pagination: two deviations from the conventions doc, both deliberate

**1. The cursor's timestamp is not quantised to 60s.** §4.3 says to. Doing it
breaks the keyset: flooring the sort key to the minute makes the comparison
exclude every row later in that same minute, so on an active board page two
comes back empty and posts become unreachable. The quantisation exists to stop
an attacker binary-searching a post's publication time, and that attack presumes
a *readable* cursor — ours is HMAC-signed and opaque, so the signature already
carries the property. Coarse timestamps in the response body are a separate
control and are unaffected.

**2. The keyset compares a numeric epoch, not a timestamptz.** Passing the
timestamp as a parameterised `timestamptz` returned zero rows for a cursor whose
values were provably correct — the same SQL worked in psql. Rather than fight
driver type inference on a correctness-critical path, the key is
`extract(epoch from created_at)::numeric(20,6)` on both sides. Unambiguous, and
it keeps microsecond precision that a JS `Date` (milliseconds only) would drop.

Both are flagged for review against the conventions doc.

## Open questions

1. **Board tier gating is not implemented.** `board.min_tier_to_read` exists and
   the query ignores it, so a provisional user could read a card-verified board.
   Needs the tier ordering from the caller's context.
2. **Comment pagination.** Threads load every comment; the design shows 62 on
   one post. Needs its own keyset before a long thread ships.
3. **Blocked users** are not filtered out of feeds or comment threads.
4. **Hot ranking** is unused — feeds sort by recency only, so the design's
   POPULYAR tab has no server support yet.
