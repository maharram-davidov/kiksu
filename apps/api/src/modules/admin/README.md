# Admin module

The two staff queues. Unblocks the student-card route, which until now filed a
case with a 24-hour SLA that nothing could approve.

| Endpoint | |
|---|---|
| `GET /v1/admin/verification/queue` | Card cases awaiting a decision |
| `POST /v1/admin/verification/:id/decide` | Approve or reject; approval provisions the pseudonym |
| `GET /v1/admin/moderation/queue` | Reported content awaiting triage |
| `POST /v1/admin/moderation/:id/decide` | Act, and always log |

## Staff membership is a lookup, never a claim

`StaffGuard` reads `moderation.staff` on every request rather than trusting a
JWT claim. A claim is only as fresh as the last token mint, and **revoking a
moderator has to take effect now**, not whenever their session happens to
refresh. The identity spec makes the same argument about per-board scope.

A non-staff caller gets `not_found`, not `forbidden`. Whether an admin surface
exists at a given path is not something an ordinary student needs confirmed.

## The verification queue

Sorted by **SLA deadline, not submission time**. Those usually agree; when they
diverge, the deadline is what the app told a student, and that is what the
queue should chase.

Approval is where Layer 1 and Layer 2 finally meet, and it is the only place in
the product where a human looks at an identity document. Two properties follow:

- **The evidence pointer is cleared on decision.** A decided case has no
  further use for the image, and keeping it is pure downside. The sweeper
  deletes the file from there.
- **A student who already has a pseudonym keeps it.** Approving their card
  upgrades the tier; it does not mint a second identity. One person, one
  account, is enforced by `identity.app_user_link`.

## The moderation queue

**Every decision writes an action row, including `no_action`.** A queue that
logs only removals cannot answer "was this looked at and kept" — which is
exactly the question a transparency report and an appeal both turn on.

Both queues are deliberately thin: list, decide, log. Anything cleverer —
auto-approval, bulk actions, heuristics that pre-judge — belongs behind a human
until there is evidence about what these queues look like in practice.

## Gaps

1. **No web console.** These are API endpoints; the plan's AD-01/AD-02 screens
   do not exist. A moderator currently needs curl.
2. **Nothing opens a moderation case.** Reports from the app (`FR-13`) are not
   wired, and there is no automated classifier, so the queue only fills if a
   row is inserted by hand. The forum is still effectively unmoderated.
3. **No appeals.** `moderation.appeal` exists in the schema and nothing writes
   or reads it.
4. **Card approval mints a fresh `auth.users` row** because the card route's
   subject key derives from an auth subject the API does not otherwise hold. In
   production this is the Supabase user the client already has; the seam is
   marked in the service.
