# Timetable module

The product's daily-use hook. Three read endpoints; writes come later.

| Endpoint | Purpose |
|---|---|
| `GET /v1/timetable/week` | The week grid for the caller's current term |
| `GET /v1/timetable/attendance` | Per-course absences against the configured limit |
| `GET /v1/timetable/courses?q=` | Catalogue search, campus-scoped |

## Three things that matter here

**Scoping is this module's job, not the database's.** The pool authenticates as
a BYPASSRLS role (see `SqlProvider`), so no policy filters these queries. Every
statement constrains on the caller's university and current term explicitly. A
missing predicate is a cross-campus data leak, not a slow query — which is why
three of the integration tests re-scope the *same enrolled user* to another
campus and assert they see nothing.

**The week grid is one query.** The naive shape is a query per day or per cell:
at five days by eight slots that is forty round trips for the screen students
open every morning.

**Absence limits are configuration, never constants.** `ref.effective_absence_limit()`
resolves the course → faculty → university chain. The design shows 12 for BDU,
but that is BDU's policy and a second campus will differ. The endpoint returns
the limit, the count *and* the derived ratio so the client never reimplements
policy arithmetic — the design renders "4 / 12" beside "33% of the allowed
absences used" and both must agree with the server.

## Azerbaijani search

Query text goes through `util.tsq()` so it is folded exactly as the indexed text
was. Students type `e` for `ə` constantly; folding one side but not the other
silently returns nothing for the most common spelling of half the catalogue.
Two tests cover it — `verilenler` and `Verilənlər` must both find CS 214.

## Tests

    ./scripts/test-integration.sh

Stands up a throwaway Postgres, applies all migrations and the seed, then runs
the suite against it. Integration tests skip when `DATABASE_URL` is unset, so
plain `npx vitest run` stays fast.

They assert against real rows rather than mocks: the CS 214 slot must come back
as Ç.A 14:05–15:25 in room 312 with dos. Nigar Əliyeva, matching the design.

## Open questions

1. **Timezone.** Meeting times are `time` in `ref.university.timezone`, returned
   as wall-clock strings with the zone alongside. The client must not treat them
   as instants. If a campus ever spans zones this breaks, but no Azerbaijani
   university does.
2. **Week parity.** `ref.section_meeting.parity` supports odd/even-week
   scheduling but the grid endpoint ignores it, so a fortnightly class shows
   every week. Needs the term's week number to resolve. Not in the design.
3. **Meeting exceptions.** `ref.section_meeting_exception` exists (cancellations,
   room moves) and is not yet applied to the grid.
4. **Late arrivals.** Absence policy has `late_counts_as` (0.5 by default) but
   the attendance count treats every non-excused row as whole. Needs weighting
   once the client can record a late.
