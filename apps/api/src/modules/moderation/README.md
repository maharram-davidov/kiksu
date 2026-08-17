# Moderation pipeline

Tier 1 of the plan's tiered classifier. Runs at write time, inside the same
transaction as the content insert.

## Why it runs inside the transaction

Classifying afterwards leaves a window where a phone number is fully visible.
The entire point of an automated tier is to shrink that window to zero for the
things it can be certain about, so the classification and the insert commit
together or not at all.

## What tier 1 does and deliberately does not do

It fires only on **structurally identifiable** things: Azerbaijani mobile
numbers, email addresses, messaging handles, link floods, character floods,
pasted student IDs.

It makes no attempt at tone, insult or context. A rule that tried to detect
"rudeness" by Azerbaijani keyword would produce constant false positives, and a
moderation layer that cries wolf gets ignored by the humans it exists to help.
Twelve tests assert it stays silent on real student writing — room numbers,
course codes, years, prices and the seeded forum posts all pass through clean.

**Severity 5 hits are limited immediately** rather than waiting for reports. A
phone number is not a judgement call, and the damage is done the moment the
post is readable. Everything else opens a case and stays visible.

**The queue row never quotes what it matched.** A case that repeats the phone
number it found has copied the personal information into a second place.

## Tier 2 is deferred, by decision

An LLM pass for tone and context is **not being built for now**. Tier 1 plus
human reports is the agreed coverage until there is evidence that it is not
enough. Revisit when the queue shows what actually gets past it — that evidence
is worth more than a guess made before launch.

It is absent rather than stubbed on purpose. A stub returning "looks fine" would
make every write appear classified while catching nothing, and **a moderation
layer that fails open is worse than one that is honestly missing.** The seam is
`ModerationService.classifyOnWrite`, which already returns a shape that
accommodates a second tier.

### Listings are a deliberate exception

Forum posts and reviews containing a phone number are **limited immediately**.
Listings are **not** — they open a case for a human and stay visible.

That is not an inconsistency. In-app deal chat does not exist yet, so a phone
number is currently the only way a buyer can reach a seller. Limiting on
contact details would make the marketplace unusable rather than safer, and an
unusable marketplace pushes the same conversation to WhatsApp where Kiksu can
see none of it.

**This should flip to limiting the moment deal chat ships.** The exception
exists because there is no alternative, not because posting a number in a
listing is fine. The composer already warns before the seller types it.

### What that means in the meantime

Abuse, harassment, and criticism of a lecturer that has tipped into something
defamatory are caught **only when a student reports them**. Those are the cases
the legal section of the product plan is most concerned with, so two things
matter more while tier 2 is absent: report entry points on every surface (only
posts have one today), and moderator response time against the published SLA.
