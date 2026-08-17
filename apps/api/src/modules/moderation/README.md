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

## Tier 2 is not implemented

An LLM pass for tone and context — the thing the product plan actually leans on,
because off-the-shelf toxicity APIs are effectively blind to Azerbaijani — does
not exist. It needs an API key, a per-write budget and a latency decision, none
of which have been made.

It is absent rather than stubbed on purpose. A stub that returned "looks fine"
would make every write appear classified while catching nothing, and **a
moderation layer that fails open is worse than one that is honestly missing.**

## Consequence worth stating plainly

Between tier 1 and human reports, nothing catches abuse, harassment, or
criticism of a lecturer that has tipped into something defamatory. Those are
precisely the cases the legal section of the product plan is most concerned
with, and today they are caught only when a student reports them.
