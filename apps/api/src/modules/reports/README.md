# Reports module

Fills the moderation queue. Until this existed the queue could only be
populated by hand, so the forum was unmoderated no matter how good the staff
tooling was.

| Endpoint | |
|---|---|
| `GET /v1/reports/reasons?target_type=` | Reasons applicable to that target |
| `POST /v1/reports` | File one. Always 202, no body. |

## The response never varies

Duplicate, unknown target, already-hidden content — all 202. A response that
varied would let a reporter probe for whether a given piece of content exists
and whether anyone else has flagged it. The client mirrors this: the sheet says
"sent" even when the request fails, because a failure is ours to see in
telemetry, not the reporter's to interpret.

The single exception is a reason that does not apply to the target type. That
is a client bug rather than a user action, so it errors.

## Three properties that keep this from being a weapon

**One report per person per target.** A second is silently ignored, including
under a different reason. `report_count` drives the auto-hide threshold, so
without this one determined person could hide anything.

**A case keeps the highest severity ever reported.** A spam report arriving on
top of a harassment report must not demote it down the queue.

**Auto-hide limits, it does not remove.** Once enough *distinct* people report,
content moves to `limited` — still reachable by direct link, reversible in one
update. `removed` is a human's decision. And judgement-call reasons
(`off_topic`, `false_info`) have **no threshold at all**: an automatic hide
there would hand a brigade a delete button for anything they merely dislike.

Thresholds are per-reason configuration in `ref.report_reason`, set low for
things that cause harm quickly — personal information at 2, harassment at 3.

## Gaps

1. **Only the post screen has a report entry point.** Comments, reviews and
   listings are reportable by the API but have no UI.
2. **No automated classification.** Everything reaching the queue is
   human-reported. The product plan's LLM first pass does not exist, so
   nothing is caught before someone sees it and objects.
3. **No notification to the reporter, ever** — stated in the sheet, but there
   is also no appeal path for the person reported.
