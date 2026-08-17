# Reviews module

Course and professor reviews — the last Phase 1 pillar.

| Endpoint | |
|---|---|
| `GET /v1/reviews/instructors/:id` | Profile with aggregates. **Ungated.** |
| `GET /v1/reviews/instructors/:id/reviews` | Written reviews. Gated by contribution. |
| `POST /v1/reviews` | Write one. Structured ratings required, prose optional. |

## No author, not even an ordinal

`public.review` has no author column at all; authorship lives in
`internal.review_author`, which this connection cannot reach. Reviews go
further than forum posts, which do carry a per-thread `Anonim N` — a course
cohort is small enough that "Anonim 3, spring term" narrows to a handful of
people, and a review is far more consequential to its author than a board
comment. A test serialises a page and asserts the strings `alias`, `handle` and
`app_user` appear nowhere in it.

The one legitimate read of `internal.review_author` in the whole product is
counting how many reviews **the caller themselves** wrote this term. It answers
"how many did you write", never "who wrote this".

## The contribution wall gates prose, not numbers

Write one review a term to read other people's writing. But the histogram and
criterion averages are visible to everyone, because a rating summary is what
makes the wall worth climbing — gating everything leaves a student at a locked
door with no reason to open it.

It returns **200 with an empty list** and the wall's state, never a 403. A wall
you hit by accident teaches nothing; one you can see coming is a bargain you
can choose to take.

## Structured first, prose optional

That ordering is what makes the feature survivable. An average of numeric
ratings is far harder to characterise as defamation than a paragraph, and it is
also the part that aggregates. The prose is what students come for; the numbers
are what the product can defend. Tags are a **closed vocabulary** for the same
reason — an open tag list on a named person becomes a place to write exactly
what the free-text guardrails exist to prevent.

`is_enrollment_verified` drives the design's DOĞRULANMIŞ badge. Not being
enrolled is not a gate: someone who dropped the course still has a view worth
hearing, it just carries less weight.

## Known gaps

1. **`top_tags` is computed live** rather than read from
   `instructor_review_summary.top_tags`, because the scheduled recompute that
   fills that column does not exist. One grouped scan per profile is trivial at
   realistic counts; move it back to the column when the job lands.
2. **The seed gives one course, not the design's three.** All 61 seeded reviews
   are CS 214, so `course_count` reads 1. A seeding limitation, not a bug.
3. **No moderation.** Reviews are visible on write. The moderation queue
   (AD-01) does not exist, and free text about a named person is exactly what
   it is for. This is the largest gap in the module.
4. **No right of reply.** The product plan promises verified staff can respond
   under their own name and request review of a specific item. Nothing
   implements it, and it is the mitigation the legal section leans on hardest.
