# Kiksu — Identity, Anonymity and Verification Specification

Stage 1 contract document. Owner: Identity Architect.
Companion to `docs/00-project-brief.md` (authoritative) and `design/kiksu-mobile-screens.html`
(UI source of truth). Table shapes, columns and indexes are owned by the Schema Architect;
where this document names a store it states **what that store must guarantee**, not its DDL.

No application code appears here. Pseudocode is used only to pin down algorithms.

---

## 0. Surface inventory — which layer renders where

Every de-anonymisation bug in this product will be a surface rendering a layer it was not
entitled to. This table is the reference for every later section.

| Design surface | Identifier rendered | Layer | Attributes rendered | Notes |
|---|---|---|---|---|
| 01 Onboarding | none | — | university (self-selected) | Pre-account |
| 05 Forum board, post rows | `A1` chip + `ANONİM` + tier badge | thread_alias | none | Chip is the author's alias *in that thread* |
| 06 Post detail, OP | `ANONİM 1` + `MÜƏLLİF` + tier badge | thread_alias | none | OP is always ordinal 1 |
| 06 Post detail, comments | `ANONİM 2..N` + tier badge | thread_alias | none | `ANONİM 3` renders **no** tier badge |
| 06 Composer footer | `ANONİM 5 KİMİ YAZ` | thread_alias (preview) | none | Pre-write promise; see §3 |
| 07 Professor review | `ANONİM · DOĞRULANMIŞ` | none (fully unlinked) | none | Reviews carry **no** alias and **no** handle |
| 08 Marketplace seller | `quru-püstə-19` + `✓` | app_user | `BDU · İNFORMATİKA · 2-Cİ KURS` | **Only surface rendering faculty.** Highest k-anon risk |
| 09 Vacancies | none | career_profile | none | "forum ləqəbin işəgötürənə görünmür" |
| 10 Profile (self) | `sakit-pərvanə-37` | app_user | `BDU · 2-Cİ KURS` | Karma 312, 28 posts, 4.8 rating |
| 10 Profile, career card | `Aysel Rəhimova` | career_profile | none | Owner-only, marked `GİZLİ` |

**Rule S-1.** No surface may render a thread_alias and an app_user handle for the same piece of
content, in the same response, or in the same screen. The forum renders aliases; the marketplace
and profile render handles; reviews render neither. There is no surface that renders both.

**Rule S-2.** The `verified_identity` layer is never rendered. What surfaces render are
*k-anonymised generalisations* derived from it by the identity service (§5), materialised as
pre-rendered label strings on a public projection. No read path touches the sealed store.

---

## 1. Threat model

Attacker profile assumed throughout: **a curious, technically capable student with a normal
account, a rooted/jailbroken phone, an HTTP proxy, a scripting environment, and offline
knowledge of the target** (their timetable, their faculty, who they sit next to, what they
complained about yesterday). Not a nation state; also not a naive user. A secondary attacker is
**a malicious insider with SQL read access** — the four-layer model exists mostly for them.

Severity scale:
- **S1 Catastrophic** — deterministically de-anonymises a specific user, or breaks a layer boundary at scale.
- **S2 High** — narrows a poster to a small set (< 20) or links two pseudonymous surfaces.
- **S3 Medium** — provides a probabilistic signal that composes with other signals.
- **S4 Low / accepted** — real but unmitigable at reasonable cost; must be documented to users.

### S1 — Catastrophic

**T1. Sealed-layer join through a "convenient" feature.**
The most likely breach is not an attack; it is a future ticket ("show which faculty is most
active on this board"). Any query joining `verified_identity` to `app_user` outside the
verification/legal services collapses layers 1 and 2 permanently, because the result gets cached,
logged, and exported.
*Mitigation.* (a) Separate Postgres schema for the sealed store with **zero grants** to `anon`,
`authenticated`, and the general application role — only a dedicated `identity_service` role.
(b) No foreign key from the sealed store to `app_user` and none back; the association is by a
column with no FK constraint, resolvable only inside the identity service. (c) A CI lint over
all SQL text and all generated queries that fails the build if any file outside
`services/verification/**` and `services/legal/**` mentions both identifiers (assertions 1–6).
(d) An **operational alarm on read volume**: in steady state the sealed store should see fewer
than ~100 reads/day; a step change is a detector for exactly this bug.

**T2. Small-cohort attribute inference (the marketplace seller line).**
Screen 08 renders `BDU · İNFORMATİKA · 2-Cİ KURS` beside a stable handle. On a 9-person
programme this is a name. Worse, it is *stable* — the attacker can enumerate listings, build a
roster of (faculty, year) tuples, and intersect with what they know of their department. The
brief's own example (3rd year, Petroleum Engineering) is exactly this surface.
*Mitigation.* The k-anonymity floor of §5, applied per surface with an explicit generalisation
path, computed in a daily batch so that individual cohort transitions are not observable.

**T3. Career profile ↔ pseudonym linkage.**
Four concrete vectors, all of which bypass "no traversable foreign key":
 (a) **Storage object keys.** If the CV lives at `cvs/<app_user_id>/cv.pdf` the FK is in the path.
 (b) **Push tokens.** A device token registered by both the forum service and the career service
     is a join key sitting in two tables.
 (c) **Timestamps.** `career_profile.created_at` within seconds of an `app_user` event is a
     high-confidence match when the daily volume is low (launch phase: near-certain).
 (d) **Logs.** One request that carries both ids in the same trace joins them forever.
*Mitigation.* The career silo binds to the **auth subject**, not to `app_user`, and binds through
a keyed one-way reference: `subject_ref = HMAC-SHA256(K_career, auth_user_id)` where `K_career`
lives in KMS/Vault and is readable only by the career service. Consequences: a full database dump
yields no join; a DBA cannot link; the career service can resolve forward (subject → ref) but not
backward (ref → subject) without enumerating the user set, which it cannot read. Additionally:
separate storage bucket, ≥128-bit random object keys with no shared prefix scheme, separate
encryption key, no shared push topic, no shared request trace, and career timestamps stored
truncated to the day.

**T4. The moderation audit log as a permanent alias↔user join table.**
Moderation is where anonymity legitimately has to be pierced, which means the moderation trail is
the one place where `thread_alias`, `app_user_id` and sanction history are all in scope. A naive
audit row (`case_id, reporter_user_id, subject_user_id, thread_id, alias_ordinal, action`) is a
*complete de-anonymisation index for the whole forum*, retained indefinitely, and readable by
every moderator and every analyst who gets access to the moderation database.
*Mitigation.* (a) Moderation cases reference **content ids only**. (b) Author resolution is
performed by a privileged resolver in the identity service, is access-logged, and returns a
**case-scoped ephemeral subject label** `HMAC(K_mod, case_id ‖ app_user_id)` rendered as e.g.
`Subyekt-7fA2`. The same user in two cases has two unrelated labels. (c) Repeat-offender
signalling is a **number** returned by the resolver ("3 prior sanctions"), never a case list.
(d) Audit rows persist only the case-scoped label, never the durable id. (e) Moderators never see
handle, karma, post count, university, or any other case.

**T5. The karma-delta oracle.**
Screen 10 shows `312 KARMA` and `28 POST`. If a profile is viewable by handle, an attacker polls
a target handle's karma every minute while watching the forum. A post that gains +211 upvotes
produces a +211 karma jump on exactly one handle. This links a stable pseudonym to a specific
anonymous post *with certainty*, using only documented API surface. The same attack works with
the post counter (a +1 at time T narrows to the posts made at time T).
*Mitigation.* (a) Karma and post count are **owner-only** by default; if a public profile exists,
it renders karma bucketed (e.g. 0–99 / 100–499 / 500+) and the bucket is recomputed only in the
daily batch, so it is byte-identical between refreshes. (b) The post counter is never public.
(c) The same reasoning applies to the marketplace `12 SÖVDƏLƏŞMƏ` counter — deal count is public
by product necessity, but marketplace deals are already handle-attributed, so no cross-layer leak
arises. (d) Assertions 19–20.

**T6. Realtime presence and change-stream leakage.**
Supabase Realtime's presence feature broadcasts each subscriber's state to every other subscriber
by default, and `postgres_changes` replicates whole row payloads including columns the REST layer
would have projected away. A "who is viewing this thread" indicator, or a change stream on the
comments table, hands every reader the author's `app_user_id`.
*Mitigation.* (a) No presence channel on any forum surface. (b) `postgres_changes` is disabled
for `authenticated` on all forum, marketplace and identity tables; realtime updates are delivered
as **server-authored broadcast payloads** containing only what the REST projection would contain.
(c) Channel names are opaque per-thread tokens, not `thread:<uuid>` derived from anything
user-scoped. (d) Assertion 37.

**T7. Uploaded media — EXIF, and the screenshot problem.**
Screen 05 shows a post with `TAPŞIRIQ EKRAN ŞƏKLİ` (an assignment screenshot). LMS screenshots
carry the student's full name in the header. Camera uploads carry GPS coordinates, capture time
to the second, and a device serial in maker notes. Additionally, a user-scoped storage path
(`posts/<user_id>/<n>.jpg`) links every image the user ever posted, across threads and across
surfaces, from the URL alone.
*Mitigation.* (a) Server-side re-encode of every image with all metadata dropped (re-encode, not
"strip tags" — thumbnails embedded in EXIF survive naive stripping). (b) ≥128-bit random object
keys, flat namespace, no user or thread component, no shared prefix between two uploads by the
same user. (c) Client-side pre-upload warning when the image's dimensions match a common screen
size (likely screenshot) offering a redaction step. (d) Assertion 34.

### S2 — High

**T8. The block/report cross-surface oracle.**
An attacker suspects `quru-püstə-19` (marketplace) is `ANONİM 3` in a thread. They block
`ANONİM 3`. If the marketplace listing then disappears, the hypothesis is confirmed —
deterministically, with one action, using an intended feature. The report flow gives the same
oracle through "you have already reported this user".
*Mitigation.* Blocks are stored against the immutable `app_user_id` but their **visible effects
are surface-scoped by default**: a block placed from a forum thread suppresses forum content
only. A global block exists but can only be initiated from a handle-bearing surface (profile,
marketplace), where the attacker already knows the handle and learns nothing. Report
de-duplication responses are uniform ("qeydə alındı") whether or not a prior report exists.

**T9. Timing correlation between a post and a class ending.**
The post in screen 06 names an instructor and a specific class. Rendered at `· 25 dəq`, and the
board can be polled continuously to obtain near-exact publication times. If Prof. Quliyeva's
14:00 lecture ended at 15:20 and the post appeared at 15:26, the author is one of ~30 people, and
the content ("Prof. Quliyeva dərsdə bir şey demədi") confirms attendance.
*Mitigation, three parts.*
 (i) **Coarse rendered time.** The API returns a bucket label, never a raw timestamp:

  | Age | Rendered |
  |---|---|
  | < 15 min | `indicə` |
  | 15–45 min | `~30 dəq` |
  | 45–90 min | `1 saat` |
  | 90 min – 24 h | `N saat` (floor) |
  | 1–7 days | `N gün` |
  | > 7 days | absolute date, no time-of-day |

  **This conflicts with the design**, which renders `40 dəq` and `25 dəq` (5-minute resolution).
  The design's granularity is a real leak against timetable correlation and the copy should
  change. Flagged in Open questions.
 (ii) **Polling resistance.** Board feeds are served from a cache with a ≥60 s TTL and a
  quantised cursor, so continuous polling cannot recover sub-minute ordering. Sort order still
  reveals a partial order; that is accepted.
 (iii) **Contextual composer warning.** The client already holds the user's timetable. When the
  draft mentions a course or instructor entity whose class ended within the last 30 minutes, the
  composer shows a non-blocking warning that the post is timeable to that class. This is the only
  mitigation that addresses the actual risk (the content, not the metadata) and it costs nothing
  server-side.
 We deliberately do **not** add a randomised publication delay: it would destroy the
 "aralıq imtahanı təxirə salındı, kim eşitdi?" use case, which is the board's reason to exist.

**T10. Timetable sharing as a fingerprint.**
`Cədvəlimi kursdaşlarla paylaş` — a set of six course sections is very close to a primary key for
a student. Sharing course identities to "match free time" hands the recipient a full identification.
*Mitigation.* The sharing API returns **busy/free intervals only, on a ≥30-minute grid**, never
course ids, codes, rooms or instructors; it is pairwise and requires both sides opted in; it is
never joined to a handle in the same response; and results are capped (a user cannot bulk-fetch
the free/busy of a whole cohort). Assertion 38.

**T11. Enumeration of handles and ids.**
Two vectors. (a) `Axtarışda tapılım` — handle search. If it supports prefix or fuzzy matching, an
attacker walks the adjective×noun space and enumerates the entire user base together with each
user's rendered university/faculty/year. (b) Sequential or time-ordered identifiers. A `bigserial`
`app_user` id, or a UUIDv7/ULID, leaks account creation order, which leaks join cohort, which
leaks freshman status, and lets an attacker bound "who joined right after I sent my invite".
*Mitigation.* All externally visible identifiers are **UUIDv4** from a CSPRNG — explicitly not
v1/v7/ULID/snowflake, which embed timestamps. Internal surrogate keys may be sequential but must
never be exposed. Handle search accepts **exact full-handle matches only**, is rate-limited, is
opt-in (default off), and returns an identical response body and an equalised response time for
"not found" and "found but not searchable". Assertions 25–26.

**T12. Invite-graph and creation-order correlation.**
The invite route creates a real social edge: inviter → invitee. If that edge is queryable, or if
it is used for any product feature (recommendations, "your friend joined"), it converts the
pseudonymous graph into a social graph. Separately, a brand-new account posting into a low-traffic
board shortly after a known person shared an invite code is a strong signal.
*Mitigation.* The (inviter, invitee) pair lives in the **sealed layer**, is access-logged, is never
exposed in any product surface, is never used for recommendations or notifications, and is reduced
to an aggregate counter after 30 days (the abuse-investigation window). No "member since" is ever
displayed. Handles are drawn at random and encode no ordering (§4).

**T13. Invite code brute force.**
Six digits is 10⁶. If 50,000 codes are live, a random guess succeeds with p = 0.05 — the route is
not a credential at all.
*Mitigation.* (a) Codes are **scoped to the inviter's university**: a code only validates when the
redeemer has selected that same university, multiplying the effective space by the number of
universities and bounding blast radius. (b) The live-code population is capped platform-wide
(target ≤ 2,000 → p ≈ 0.002 per guess). (c) 72-hour TTL, single use, 3 live codes per inviter.
(d) Rate limits: 5 attempts/device/hour, 10/IP/hour, device lockout after 10 failures in 24 h,
plus app attestation (Play Integrity / App Attest) on redemption. (e) A platform circuit breaker
disables redemption and rotates all live codes if the invalid-attempt rate spikes. (f) Most
importantly, the invite tier is a **7-day funnel, not a destination** (§2.3): a brute-forced code
buys a badge-less, rate-limited, non-selling, non-reviewing account that expires unless a real
verification completes. This makes the attack not worth the effort, which is the only durable
defence for a 6-digit secret.

### S3 — Medium

**T14. Alias ordinal reveals arrival order.** `ANONİM 4` means "fourth distinct participant".
Combined with live polling, an observer maps each ordinal to a first-comment time window. This is
inherent to the numbering the design specifies and is not removable. Partially mitigated by the
free-list reclaim in §3 (which breaks strict monotonicity of ordinal vs. arrival) and by T9's
coarse time rendering. Accepted with documentation.

**T15. Tier badge as a partition.** At launch, if BDU has 12 card-verified users, `ANONİM KART`
on a BDU-scoped board narrows the author to 12 people.
*Mitigation.* The tier badge is subject to the k-anonymity floor: when the count of card-verified
users in the rendered scope is < 20, the `KART` badge is replaced by the neutral `DOĞRULANMIŞ`
label for that whole scope (never per-user — a per-user suppression is itself a signal).
Assertion 24.

**T16. Deletion tombstones and alias gaps.** Removing a deleted comment from the rendered sequence
turns `1,2,4,5` into evidence that participant 3 said something removable, and lets an observer who
saw the original attribute it.
*Mitigation.* Deleted comments render in place as `silinib` retaining their ordinal. Ordinals are
never renumbered. Assertion 46.

**T17. Review cohort smallness.** `2024/25 YAZ · CS 214` on an individual review: if that section
had 8 students and 3 reviews, the reviewer is one of 8, and the review text is often decisive.
*Mitigation.* A separate, lower review threshold `k_review` (proposed 5, flagged): below it, the
per-semester aggregate rolls up to all-semesters and the semester label is omitted from individual
written reviews (course code retained). Applying the full k=20 here would suppress most course
reviews and kill the feature — this needs a product decision, see Open questions.

**T18. Seller behavioural fingerprint.** `100% CAVAB · ~2 saat CAVAB VAXTI` is a behavioural
signature and a weak activity-hours leak. Accepted; response time is rendered in coarse buckets
(`< 1 saat`, `~2 saat`, `yarım gün`, `1 gün+`) and never as a raw distribution.

**T19. Poll vote timing.** `428 SƏS` updating live lets an observer who watches the counter and
knows a target just opened the app infer that target's vote timing (not their choice).
*Mitigation.* Poll counts refresh on a ≥60 s cache; no per-option live delta; no "who voted"
endpoint exists at any privilege level below the legal-request service.

**T20. Rename linkage.** If a handle change propagates to some surfaces before others, an observer
who indexed the old handle can match it to the new one. Mitigations in §4.6.

### S4 — Low / accepted, must be disclosed to users

**T21. Stylometry across threads.** Writing style, dialect, Russian/Azerbaijani code-switching,
recurring typos and emoji habits identify a frequent poster to a peer who knows them. No technical
mitigation is honest here. Disclose in the privacy explainer; the design's onboarding footer
("Real adın heç vaxt forumda görünmür") should not be read by users as "you cannot be recognised".

**T22. Self-doxxing content.** "I'm the only girl in the Petroleum group and…" defeats everything
above. Mitigated only by the composer warning of T9(iii) and by education.

**T23. Third-party SDK leakage.** A crash reporter or analytics SDK that sends a user identifier
plus a screen name to a third party reconstructs a per-user activity trail outside our controls.
*Mitigation.* No third-party analytics or crash SDK may be initialised with any Kiksu identifier;
use a rotating install id with no server-side mapping to `app_user`; identity, verification and
career screens are excluded from any screen-name reporting.

---

## 2. Verification state machine

Two machines run in parallel and must not be conflated:

- **Route machines** (A: email OTP, B: card photo, C: invite code). One instance per *attempt*.
  A user may have a live attempt on more than one route at a time — the design requires it:
  screen 10 renders `✓ E-POÇT DOĞRULANDI` and `KART: GÖZLƏYİR` simultaneously.
- **The account tier machine.** One instance per `app_user`. Tier is a pure function of the set of
  currently-valid route grants plus sanction state. Nothing writes tier directly; it is recomputed
  whenever a grant is added, expires, or a sanction lands.

### 2.0 Account tiers

| Tier | Rendered badge | Granted by | Core powers |
|---|---|---|---|
| `provisional` | *(no badge)* | Route C | Read all; post at 3/day; no marketplace; no reviews; no invites |
| `email` | `ANONİM ✓` | Route A | Full read/write; marketplace; reviews; may issue invites |
| `card` | `ANONİM KART` | Route B | As `email`, plus elevated marketplace trust surface |
| `graduate` | `MƏZUN` *(proposed — not in design)* | Time transition | Read all; post in general/career boards; no new course reviews; marketplace retained |
| `expired` | *(no badge)* | Verification lapse | Read only; existing content retained |
| `suspended` | *(no badge)* | Sanction, time-boxed | Read only |
| `banned` | n/a | Sanction, terminal | No access; credentials retained (§6.3) |

The design's screen 06 renders `ANONİM 3` with **no tier chip** while its siblings carry `✓` and
`KART`. This spec reads that as the `provisional` (invite) tier. It is flagged in Open questions
because it is also readable as a rendering variant.

`card` supersedes `email` for badge purposes; a user holding both renders `ANONİM KART`.
Tier is a *total order* for badge selection: `card > email > graduate > provisional`.

### 2.1 Route A — university email OTP ("2 dəqiqə", recommended)

| State | Entered when | Exits to | Timeout | Terminal |
|---|---|---|---|---|
| `A0 idle` | Route selected | `A1` | — | no |
| `A1 university_selected` | University chosen from allowlist | `A2`, `A_domain_reject` | — | no |
| `A2 address_submitted` | Address passes syntax + domain allowlist | `A3`, `A_rate_limited` | — | no |
| `A3 otp_sent` | Mail accepted by ESP | `A4`, `A_otp_expired`, `A_otp_locked` | 10 min | no |
| `A4 otp_verified` | Correct code within TTL | `A5`, `A_already_bound`, `A_banned_credential` | — | no |
| `A5 granted` | Grant transaction committed | `expiring`, `revoked` | 365 d | yes (for the attempt) |
| `A_domain_reject` | Domain ∉ allowlist(university) | `A1` | — | no |
| `A_rate_limited` | Send quota exceeded | `A2` after cooldown | 60 min | no |
| `A_otp_expired` | 10 min elapsed | `A2` (new send, quota permitting) | — | no |
| `A_otp_locked` | 5 wrong codes | `A2` after lockout | 60 min | no |
| `A_already_bound` | Credential hash already on an active account | recovery flow | — | yes |
| `A_banned_credential` | Credential hash in the ban set | appeal flow | — | yes |

**Anti-enumeration ordering (important).** The checks "is this address already registered?" and
"is it banned?" are deliberately deferred until **after** the OTP succeeds. Before the user has
proved control of the address, every response is identical ("kod göndərildi"). After they have
proved control, revealing the account's status leaks nothing they could not learn from the mailbox
itself. The mail *content* differs (an already-registered address receives a sign-in mail rather
than a signup code), which is invisible to an attacker who does not hold the mailbox.

**Limits.** OTP: 6 digits, 10-minute TTL, 5 attempts then burned. Resend: 60 s cooldown, 3 per
address per hour, 10 per address per day, 5 distinct addresses per device per day.

**A4 → A5 grant transaction.** Single transaction, no external calls inside it:
seal the identity record (university, faculty, entry year, evidence reference) → bind the
credential hash under a uniqueness guarantee (a lost race yields `A_already_bound`; the OTP is
**not** burned on infrastructure failure so the user can retry within TTL) → recompute tier →
increment `identity_epoch` → mint a fresh session. If any step fails, everything rolls back.

**Expiry.** `valid_until = min(verified_at + 365 d, expected_graduation + 12 months)`.

**The "2 dəqiqə" promise.** This is an SLA the system must keep, not copy.
- **Definition:** p95 of (address submitted → badge visible in app) ≤ 120 s, measured **per
  university domain**, over a rolling 60 minutes.
- **Requirements:** dedicated transactional ESP on a warmed sending domain with aligned
  SPF/DKIM/DMARC; a second ESP failover triggered at 20 s without acceptance; synchronous grant on
  OTP success (no background job may sit between verification and the badge); per-domain
  bounce/defer/greylist dashboards; synthetic probes every 5 minutes against a live mailbox at
  each university domain.
- **The likeliest breach is greylisting by a university Exchange server.** Sender allowlisting must
  be negotiated with each university's IT department and tracked as a per-university launch
  checklist item — a university cannot be enabled in the picker until its probe is green.
- **Honesty rule:** when the measured p95 for a domain exceeds 120 s for 2 consecutive hours, the
  onboarding copy for that university switches from `2 dəqiqə` to the measured value under a
  feature flag. We either keep the promise or stop making it.

### 2.2 Route B — student card photo ("24 saata qədər", manual review)

| State | Entered when | Exits to | Timeout | Terminal |
|---|---|---|---|---|
| `B0 idle` | Route selected | `B1` | — | no |
| `B1 captured` | Client quality gate passed | `B2`, `B0` | — | no |
| `B2 uploaded` | Object stored in quarantine bucket | `B3` | — | no |
| `B3 auto_screen` | Automated checks running | `B4`, `B7`, `B_fraud_hold` | 60 s | no |
| `B4 queued` | Screened clean; **SLA clock starts** | `B5` | 20 h → `B9` | no |
| `B5 in_review` | Claimed by a reviewer | `B6`, `B7`, `B8`, `B4` | 15 min claim TTL → `B4` | no |
| `B6 approved` | Reviewer approves; grant committed | `expiring`, `revoked` | 365 d | yes |
| `B7 rejected(reason)` | Reviewer or auto-screen rejects | `B0` (resubmit) or `appeal` | — | yes |
| `B8 needs_more_info` | Reviewer requests a specific retake | `B2`; **SLA clock paused** | 7 d → `B7(abandoned)` | no |
| `B9 escalated` | 20 h in queue | `B5` at priority; pages on-call | — | no |
| `B_fraud_hold` | Perceptual-hash or template anomaly | specialist queue | no SLA | no |

**Auto-screen checks (B3).** Perceptual hash against all prior submissions (one card photo
circulated among friends is the primary abuse); claimed student-ID hash already bound; university
template/logo match; OCR of the expiry date; resolution/blur/glare thresholds. A perceptual-hash
match to a *different* account routes to `B_fraud_hold`, which returns a generic
"doğrulaya bilmədik" — specific feedback here teaches forgers what to fix.

**Rejection reasons.** `unreadable`, `expired_card`, `wrong_university`, `not_a_student_card`,
`duplicate`, plus the generic fraud response. Max 3 submissions per 30 days, then appeal only.

**B6 grant transaction.** Bind the student-ID credential hash under a uniqueness guarantee
(conflict → `B7 duplicate`) → seal the identity record → recompute tier → increment epoch →
**schedule raw image deletion within 24 h of the decision** (hard cap 30 days for images stuck in
appeal). Retained after deletion: decision, reason codes, reviewer id, perceptual hash, and the
keyed student-ID hash. The photograph itself is never retained beyond that window.

**Reviewer privacy constraints.** The reviewer console shows the image, the claimed university,
and an attempt counter. It shows **no** handle, karma, post count, board activity, other
submissions, or any forum content. Reviewer identity is recorded on every decision. Approvals of
`B_fraud_hold` cases require two distinct reviewers. Reviewers are assigned cases outside their own
university where staffing permits.

**The "24 saata qədər" promise.**
- **Definition:** 99% of submissions reach `B6`/`B7`/`B8` within 24 h of entering `B4`, measured
  over a rolling 7 days. Time in `B8` (waiting on the user) does not count.
- **At 20 h:** automatic escalation (`B9`), priority bump, on-call page.
- **At 24 h undecided:** the user is notified with a concrete revised ETA and offered the email
  route as an alternative. **The system never auto-approves on timeout** — a timeout is a staffing
  failure, not a verification.
- **Honesty rule:** if the rolling 99th percentile exceeds 24 h on 2 consecutive days, the
  onboarding copy switches from `24 saata qədər` to the measured value under a feature flag.
- Queue depth, oldest-item age and reviewer throughput are first-class alerting metrics.

### 2.3 Route C — invite code (6 digits)

| State | Entered when | Exits to | Timeout | Terminal |
|---|---|---|---|---|
| `C0 idle` | Route selected | `C1` | — | no |
| `C1 code_entered` | Code submitted with a selected university | `C2`, `C_invalid`, `C_locked` | — | no |
| `C2 code_valid` | Code live, unused, university matches, attestation passes | `C3` | — | no |
| `C3 provisional` | Grant committed; code marked consumed | `C4`, `C5` | **7 days** | no |
| `C4 upgraded` | Route A or B completed | — | — | yes |
| `C5 provisional_expired` | 7 days without upgrade | `C4` on later verification | — | no |
| `C_invalid` | Wrong / expired / consumed code | `C1` | — | no |
| `C_locked` | 10 failures in 24 h on a device | `C1` after lockout | 24 h | no |

**Issuance.** Only from tier `email` or `card`, account age ≥ 14 days, karma ≥ 20 *(both tunable;
flagged)*. Max 3 live codes per inviter, max 5 redemptions per inviter per semester. Codes are
drawn uniformly at random from the currently-unallocated 6-digit space **within the inviter's
university namespace**, are single-use, and expire after 72 hours.

**`C_invalid` is a single response for wrong / expired / already-consumed / wrong-university.**
No distinguishable error and no distinguishable timing, or the code space becomes an oracle.

**Provisional tier is a funnel.** On `C5` the account reverts to read-only and its posts are
**hidden pending verification** (not deleted; restored on `C4`). This bounds the value of a
brute-forced code to seven days of rate-limited, badge-less posting. The hide-vs-retain choice is
a product call and is flagged.

**Invite-graph handling** is specified under T12: sealed, access-logged, product-invisible,
aggregated away after 30 days.

### 2.4 Expiry, re-verification, and the graduate tier

```
  granted ──(valid_until − 30d)──▶ reverification_due ──(valid_until)──▶ expired
     ▲                                     │                                │
     └──────── successful re-run of route A or B ◀────────────────────────┘
```

- `reverification_due` is cosmetic: an in-app banner, no functional change. 30-day window.
- `expired` removes the badge, blocks posting/selling/reviewing, retains read access, retains all
  content, retains handle, karma, blocks and sanctions. Bumps `identity_epoch` (§7).
- Re-verification restores the previous tier on the **same** `app_user`. It never creates a new
  account and never resets karma or the rename cooldown.
- **Graduation.** `expected_graduation = entry_year + nominal_programme_years` (sealed, configured
  per programme per university). At `expected_graduation + 12 months`, an account that has not
  re-verified as a current student transitions to `graduate`.
- **Graduate tier is effectively terminal on the email route**, because universities deactivate
  student mailboxes. A graduate who re-enrols must therefore be able to *add* a new credential
  from a logged-in session (§6.4). Graduates are counted in a **separate** k-anonymity population
  from current students, otherwise cohort counts drift upward and the floor stops meaning what the
  brief says it means.
- The design shows no graduate badge; `MƏZUN` is a proposal, and the precise graduate permission
  set is flagged in Open questions.

---

## 3. Thread alias assignment

The design makes a **promise before the write**: the composer footer reads `ANONİM 5 KİMİ YAZ`.
That promise is a reservation, not a prediction, and reservations that are never used must not
leave permanent holes in the numbering.

### 3.1 Required properties, in priority order

| # | Property | Strength |
|---|---|---|
| P1 | Within a thread, an ordinal maps to at most one person, forever | **Absolute** |
| P2 | Within a thread, a person maps to exactly one ordinal (posting twice keeps the alias) | **Absolute** |
| P3 | The rendered ordinal sequence has no permanent gaps | **Absolute** |
| P4 | The thread author holds ordinal 1 | **Absolute** |
| P5 | Ordinals are never reused across threads for the same person | **Absolute** (trivially: allocation is per-thread and independent) |
| P6 | A preview shown at time *t* is the ordinal actually assigned | **Best-effort, guaranteed within the hold TTL** |
| P7 | Ordinal order matches arrival order | **Not guaranteed** — deliberately weakened, see 3.5 |

P6 and P3 cannot both be absolute; P3 wins because a permanent gap is a privacy signal
("someone opened the composer and thought better of it") and P6 is a UX promise with a bounded
window in which it is exact.

### 3.2 Stores required (guarantees, not DDL — for the Schema Architect)

1. **Alias map.** Holds `(thread, app_user, ordinal, allocated_at)`.
   Must guarantee: uniqueness of `(thread, app_user)`; uniqueness of `(thread, ordinal)`.
   Must have **zero grants** to `anon` and `authenticated`.
2. **Thread alias counter.** Exactly one row per thread holding the high-water ordinal.
   Must be lockable for update and must be the *only* row contended during allocation.
3. **Free list.** Ordinals below the high-water mark that were reserved and released without ever
   being rendered on published content. Must guarantee that an ordinal can appear at most once.
4. **Holds.** `(thread, app_user, ordinal, expires_at)`, uniqueness on `(thread, app_user)` and on
   `(thread, ordinal)`. **Not transactional with content.** Advisory only.
5. **Denormalised ordinal on the content row.** Every post/comment carries its ordinal directly.
   This is what makes the read path safe (3.6).
6. **Thread-scoped author reference on the content row.** See 3.6.

### 3.3 Preview (composer opens)

```
preview(thread T, caller U):                       # U comes from the JWT, never from a parameter
  if alias_map has (T, U):                         # already participating
      return existing ordinal                      # no hold, nothing consumed
  if holds has live (T, U):
      extend expires_at; return held ordinal       # idempotent re-open
  begin transaction
      lock counter row for T                       # SELECT ... FOR UPDATE
      n := smallest entry in free_list(T)          # prefer reclaimed ordinals
      if n is null:
          n := counter.high_water + 1
          counter.high_water := n
      else:
          remove n from free_list(T)
      insert hold (T, U, n, now + 5 min)
  commit
  return n
```

- **Hold TTL is 5 minutes, extended to a maximum of 30 minutes** by composer heartbeats (typing,
  app foregrounded). The client re-issues `preview` on resume; the call is idempotent.
- A hold consumes an ordinal. This is what makes the promise real.
- `preview` takes **no user parameter**. The caller identity is bound from the token inside a
  privileged function. There is no form of this call that answers "what ordinal does *someone
  else* have".
- Rate-limited (a preview per thread per user per few seconds) and access-logged, because it is
  one of only two readers of the alias map.

### 3.4 Allocation (the write)

Allocation happens **inside the same transaction as the content insert**. Not before, not after.

```
allocate(thread T, caller U) -> ordinal:
  if alias_map has (T, U): return that ordinal           # P2, idempotent
  if holds has live (T, U) with ordinal n
     and (T, n) is free in alias_map:
        insert alias_map (T, U, n); delete hold; return n # P6 honoured
  lock counter row for T                                  # single contended row
  n := smallest free_list(T) entry, else ++high_water
  insert alias_map (T, U, n)
  return n
```

- **Thread creation** calls `allocate` for the author first; the counter starts at 0, so the author
  necessarily receives 1 (P4). No special case is needed, but it must be asserted (assertion 15).
- If the content insert rolls back, the alias-map insert rolls back with it and the ordinal is
  free again. There is therefore **no such thing as an orphaned allocation** — only orphaned
  holds, which have a TTL.
- Allocation and content insert being in one transaction is a hard requirement. Two transactions
  produce orphans that violate P3 and are unrecoverable after the fact.

### 3.5 Expiry and reclaim

A background sweep (every minute) moves ordinals from expired holds into the thread's free list.

**Reclaim is safe** because a hold is strictly pre-write: an ordinal released from an expired hold
has provably never appeared on any published content, so re-issuing it cannot violate P1. The
sweep must assert this (the ordinal must be absent from the alias map) and must skip and alarm if
it is not.

Reclaim produces a **temporarily visible gap** — a reader may see `1, 2, 3, 4, 6` for up to five
minutes while ordinal 5 is held, and `5` may appear later, out of chronological order. This is
acceptable and is in fact a small privacy gain: it breaks the strict ordinal↔arrival-order
correspondence that T14 exploits (P7 is intentionally not a property).

The alternative design — a purely optimistic prediction with no reservation — was rejected: it
breaks the design's stated promise whenever two people compose at once, which on a busy thread is
most of the time.

### 3.6 Why the mapping cannot be reversed from an application context

Five independent mechanisms, because one is not enough:

1. **The read path never touches the alias map.** The ordinal is denormalised onto the content row
   at insert time. A comment read is a projection of the content row alone. An over-permissive RLS
   policy, a leaked read-only credential, or a SQL injection on the read path yields ordinals and
   text — no user identifiers, because none are in that table's projection.
2. **The content row carries no `app_user_id`.** Ownership for edit/delete is proved by a
   **thread-scoped keyed reference** stored on the row:
   `author_ref = HMAC-SHA256(K_alias, thread_id ‖ app_user_id)`.
   The server computes `author_ref` for the current caller and passes it as a request-scoped
   value; the row-level policy compares equality. Properties: it is not invertible without
   `K_alias`; it is *thread-scoped*, so two `author_ref` values for the same person in two threads
   are uncorrelated, which closes cross-thread correlation (T-cross-thread) at the storage layer.
3. **`K_alias` lives in the server layer, not in the database.** A database-only compromise cannot
   compute `author_ref` for a candidate user, and a server-only compromise cannot read the user
   set. Reversal requires both. State this plainly: **aliases are reversible only by combining the
   server key with the alias map; neither alone suffices.**
4. **No grants.** The alias map is unreachable from `anon`/`authenticated`. Its only two readers
   are `preview` (token-scoped to the caller, no user parameter) and the moderation resolver
   (privileged service, access-logged, returns case-scoped labels per T4).
5. **Cold-thread erasure.** For threads with no activity for 90 days, the alias map rows are
   **deleted**, permanently destroying reversibility for that thread while the ordinals remain on
   the content. Cost: a user returning to a very old thread receives a new ordinal (P2 is scoped to
   the live window). This is a strong property and is recommended; the 90-day figure and the P2
   relaxation are flagged in Open questions.

### 3.7 Concurrency guarantees required from the database

Handed to the Schema Architect as requirements:

- **Isolation level `READ COMMITTED` is sufficient.** No serialisation anomaly is possible because
  all concurrent allocations within a thread are forced through one row lock. Do not rely on
  `SERIALIZABLE`; do not rely on advisory locks alone (they do not survive the pattern where a
  connection is recycled mid-transaction by a pooler in transaction mode).
- **Row-level exclusive lock on the thread's counter row**, taken with `SELECT ... FOR UPDATE`, is
  the primitive. It must be taken *before* touching the free list, and released only at commit.
- **Deadlock freedom by construction:** exactly one lock row per thread; no second lock is acquired
  while it is held; therefore no lock cycle. This must remain true — any future code that locks a
  second row inside an allocation reintroduces deadlocks.
- **Uniqueness on `(thread, ordinal)`** in the alias map is the last line of defence for P1; a
  violation must surface as an error, never be swallowed by an upsert. Explicitly: **do not**
  implement allocation with `ON CONFLICT DO NOTHING` on the ordinal — that silently drops the
  write and produces two users with one alias or a comment with none.
- **Uniqueness on `(thread, app_user)`** is the enforcement of P2 and is the retry-safe idempotency
  key: a retried request that already allocated returns the same ordinal.
- **No external calls inside the transaction.** No HTTP, no storage upload, no push. The lock must
  be held for microseconds. Media uploads complete before the transaction opens.
- **Throughput.** One row lock per thread serialises allocation to a few thousand per second per
  thread, which is orders of magnitude above the busiest plausible thread. Contention is per-thread
  and does not couple threads.
- **Connection pooling.** With PgBouncer in transaction mode, the whole allocation must be a single
  statement or a single explicit transaction issued as one unit; a multi-round-trip transaction
  that spans pool checkouts breaks the lock guarantee.

---

## 4. Pseudonym generator

Format: `adjective-noun-number`, Azerbaijani, lowercase, hyphen-separated.
Design examples: `sakit-pərvanə-37` (quiet-moth-37), `quru-püstə-19` (dry-pistachio-19).
Both examples use a two-digit number.

### 4.1 Space sizing

Let `S = |ADJ| × |NOUN| × |DIGITS|`, with the two-digit band `10..99` giving `|DIGITS| = 90`.

Handles are enforced unique, so the metric that matters is not birthday collision probability but
**occupancy** `ρ = live handles / S`, which determines the retry rate:

| ρ | P(first draw succeeds) | P(success within 3 draws) | Expected draws |
|---|---|---|---|
| 0.01 | 99.0% | 99.9999% | 1.010 |
| 0.05 | 95.0% | 99.9875% | 1.053 |
| 0.20 | 80.0% | 99.2% | 1.250 |
| 0.50 | 50.0% | 87.5% | 2.000 |

**Target: ρ ≤ 0.05.**

Live-handle budget: assume 200,000 users (roughly the Azerbaijani university population), plus
quarantined former handles. If 20% of users rename once a year and quarantine is 12 months
(§4.6), that is ~40,000 quarantined at steady state. Budget **300,000 live handles**, and note that
the offensive-pair denylist (§4.3) removes perhaps 2% of the pair space, so size against 306,000.

Required `S ≥ 300,000 / 0.05 = 6,000,000`, hence `|ADJ| × |NOUN| ≥ 66,667`.

**Recommendation: 300 adjectives × 300 nouns × 90 = 8,100,000.** ρ at 300k live = 3.7%.
900 curated words is a realistic curation task for a small native-speaker team.

**Overflow band.** When occupancy in the two-digit band exceeds 20%, extend the number to
`100..999` (a further 900 values, ×11 the space). Three digits is visually compatible with the
design's chip layout. The band is chosen at generation time, never migrated for existing handles.

Do **not** solve a space shortage by adding more words later without care: adding words is safe,
but *removing* a word strands every existing handle containing it and forces a rename wave, which
is itself a linkage event (T20). The wordlist is versioned and append-mostly.

### 4.2 Wordlist sourcing and curation

- **Source.** A modern Azerbaijani frequency list intersected with a concrete-noun inventory
  (animals, insects, plants, foods, minerals, weather, household objects, textiles, colours) and a
  neutral sensory-adjective inventory. The design's own examples — `pərvanə` (moth),
  `püstə` (pistachio), `sakit` (quiet), `quru` (dry) — establish the register: everyday, concrete,
  gentle, non-evaluative.
- **Inclusion filters.** Length 3–10 characters; single token; nominative singular; no proper
  nouns; no toponyms; no ethnonyms or demonyms; no religious terms; no political or historical
  figures or dates; no body parts; no bodily functions; no medical or disability terms; no
  evaluative adjectives about people (`kök`, `çirkin`, `axmaq` and the like); no words that are
  also common given names or surnames; no loanwords with a vulgar sense in Russian or Turkish.
- **Confusable rule.** No two entries may share a Unicode confusable skeleton. Azerbaijani has
  several trap pairs (`ı`/`i`, `ə`/`e`, `ğ`/`g`, `ş`/`s`, `ç`/`c`, `ö`/`o`, `ü`/`u`). Two wordlist
  entries differing only in a diacritic would produce two handles that are visually identical in
  small type and enable impersonation on the marketplace. Enforce at wordlist build time.
- **Encoding rule.** Handles are stored and compared as **NFC**, and uniqueness comparison is
  **ordinal/byte-wise, never locale-aware**. See the casing hazard in §6.2 — the same trap applies
  here.
- **Review.** Every word reviewed by two native speakers independently, with a third adjudicating
  disagreements. The list is versioned, checksummed, and committed; the checksum is asserted in CI
  so a silent edit fails the build.

### 4.3 Offensive-combination blocklist

Word-level filtering is necessary but not sufficient: the harm lives in *pairs*. Two individually
innocuous words can compose into a slur, a sexual phrase, a defamatory idiom, or an unfortunate
reading in Russian or Turkish.

Because handles are **generated, never chosen**, the adversarial-crafting problem disappears
entirely — no user can steer toward an offensive handle. Only the residual accidental-composition
risk remains, and the pair space is small enough to attack exhaustively.

Four layers:

1. **Word denylist.** Multilingual (az, ru, tr, en) including transliterations and Cyrillic forms.
   Applied at wordlist build time — denied words never enter the list.
2. **Semantic class tagging + forbidden class pairs.** Each adjective and each noun carries
   semantic class tags (e.g. adjective classes `dirty`, `broken`, `dead`, `smelly`, `slow`;
   noun classes `animal`, `person-adjacent`, `food`, `object`). Forbidden combinations are
   expressed as class rules (`dirty × animal`, `dead × person-adjacent`, …). This removes the bulk
   of the pair space cheaply and is auditable, unlike a flat list.
3. **Exhaustive pair screening.** 300 × 300 = 90,000 pairs is small enough to screen completely
   offline: apply the class rules, then machine-screen the remainder against az/ru/tr offensive
   semantics, then have native speakers adjudicate the flagged tail (expect a few hundred items).
   Ship the result as a compact denied-pair set consulted at generation time.
4. **Number denylist.** `14`, `18`, `69`, `88` in the two-digit band; `420`, `666`, `187`, `1488`
   fragments in the three-digit band. Locally loaded numbers need a native-speaker pass — flagged.
5. **Live report channel.** `Bu ləqəbi uyğunsuz bildir`. A confirmed report adds the pair to the
   denied set **and forces a free rename** of every affected user (cooldown bypassed, no penalty).
   This is the safety valve for the tail that screening misses.

### 4.4 Generation and collision handling

```
generate_handle():
  for attempt in 1..8:
      adj  := CSPRNG uniform from ADJ
      noun := CSPRNG uniform from NOUN
      if (adj, noun) in denied_pairs: continue
      num  := CSPRNG uniform from active band, excluding denied numbers
      h := adj + "-" + noun + "-" + num
      if insert h under the uniqueness guarantee succeeds: return h
      # else: taken or quarantined -> redraw
  widen to the overflow band and retry up to 4 more times
  raise HandleSpaceExhausted   # pages on-call; occupancy alarm
```

- **The handle must be drawn from a CSPRNG.** It must **not** be derived from the user id, a
  counter, a timestamp, a hash of anything user-specific, or a shuffled sequence with a fixed seed.
  Any of those makes the handle either invertible or order-revealing (T11). Assertion 27 checks
  that the id→handle mapping is not reproducible.
- Uniqueness is enforced by the store over **both** live and quarantined handles; the generator
  never checks-then-inserts (a TOCTOU race), it inserts and handles conflict.
- Retry count is instrumented. A rising mean retry count is the occupancy alarm; trigger the
  overflow band at mean > 1.25 (ρ ≈ 0.20).

### 4.5 The 14-day change cooldown

The design states `FORUM LƏQƏBİ · 14 GÜNDƏN BİR DƏYİŞİLİR`.

- Enforced **server-side** on `handle_changed_at`, not by disabling the `DƏYİŞ` button. The client
  control is advisory; a direct API call within the window is refused. Assertion 29.
- The rename is atomic with the release of the old handle into quarantine.
- **Cooldown bypass grants** (do not reset the user's own window unfairly — a forced rename starts
  a fresh 14-day window from the forced change, and the user gets one free voluntary rename
  immediately after):
  - a confirmed offensive-pair report (§4.3.5),
  - a de-anonymisation incident affecting that user,
  - an administrative correction.
- Rename is **never announced**. No notification, no "formerly known as", no rename history on any
  surface, ever (T20).

### 4.6 What must survive a rename

The rule that makes all of this work: **every durable relationship keys on the immutable
`app_user_id`; the handle string is a render-time attribute and is never a key.**

Consequences that must be enforced:

- **Blocks and sanctions.** Stored against `app_user_id`. A rename has no effect on either.
  Assertion 28(d,e).
- **No denormalised handle strings.** Marketplace listings, reviews, search indexes and caches must
  resolve the handle at render time from one source. If any surface stores a copy, renames
  propagate unevenly and an observer who indexed the old handle can match it to the new one — that
  is exactly T20. Cache invalidation for a rename must be atomic with the rename (transactional
  outbox), and the search index rebuild must be in the same unit of work.
- **Quarantine.** A released handle is unavailable for reissue for **365 days**. Reissuing sooner
  hands a new user the reputation, the blocks and the misattributed history of the previous holder.
- **The blocker's block list is a rename oracle** — and a subtle one. If the list renders current
  handles, a user can block many people and then watch their own block list to learn the entire
  rename mapping for those people. Therefore: **the block list renders the handle as it was at
  block time** (a stored display snapshot, used for display only), while enforcement uses the
  immutable id. Unblocking is by list-entry id. Assertion 28(f).
- **Old handle is not resolvable.** No API resolves a quarantined handle to anything, including
  "this handle has changed". A 404 identical to a never-existing handle. Assertion 28(b,c).

---

## 5. The k-anonymity floor

### 5.1 The rule

> **A display tuple `D` is the ordered set of sealed attributes rendered alongside any
> pseudonymous or anonymous identifier on any surface. `Cohort(D)` is the number of `app_user`s
> with a currently-valid verification whose sealed attributes match `D` exactly. `D` may be
> rendered only if `Cohort(D) ≥ 20`. Otherwise the renderer ascends the generalisation lattice for
> that surface until the threshold is met; if the root fails, no attributes are rendered at all.**

Four points that decide whether this is implemented correctly:

- **Threshold is 20**, from the brief, applied to the *rendered* tuple, not to any internal tuple.
- **The denominator counts all verified users in the cohort, regardless of their privacy toggle
  state.** If only 3 of 25 CS second-years enable "show my year", the anonymity set for the badge
  is still 25 — an observer who sees the badge knows only that the person is one of the 25. Using
  the opted-in population as the denominator would be both wrong and far more restrictive.
- **`graduate` users are counted in a separate population** from current students (§2.4), because
  the brief's "verified users" means currently-verified students.
- **Study year is derived** (`current academic year − entry year`), so cohort membership changes
  every September for everyone at once. That mass transition is safe precisely because it is
  simultaneous; a single user's transition would not be.

### 5.2 Generalisation lattices, per surface

Levels:

```
L0  (university, faculty, programme, entry_year)   — never rendered; listed for completeness
L1  (university, faculty, study_year)              — marketplace seller line
L2  (university, faculty)
L3  (university, study_year)                       — profile line
L4  (university)
L5  ∅  →  "Doğrulanmış tələbə"
```

L2 and L3 are siblings, not a chain, so each surface declares its own descent path:

| Surface | Design string | Descent path |
|---|---|---|
| 08 Marketplace seller | `BDU · İNFORMATİKA · 2-Cİ KURS` | L1 → L2 → L4 → L5 |
| 10 Profile (own and, if public, others') | `BDU · 2-Cİ KURS` | L3 → L4 → L5 |
| Post badge, if `Postlarımda universitet nişanı` is on | `BDU` | L4 → L5 |
| Board scoping | `BDU · 9 214 İZLƏYİCİ` | see 5.4 |
| Tier badge | `ANONİM KART` | `KART` → `DOĞRULANMIŞ` (see 5.4) |
| 07 Review author | `ANONİM · DOĞRULANMIŞ` | no attributes rendered — nothing to generalise |

"Render at a coarser level" means, concretely:

- **L1 → L2:** `BDU · İNFORMATİKA · 2-Cİ KURS` becomes `BDU · İNFORMATİKA`. The year is not
  replaced by a range or a hint; it is absent.
- **L2 → L4:** becomes `BDU`.
- **L3 → L4:** `BDU · 2-Cİ KURS` becomes `BDU`.
- **L4 → L5:** becomes `Doğrulanmış tələbə` — the string is neutral and identical for every user in
  this state, so falling to L5 does not itself mark someone as rare. This is the reason the
  fallback is a fixed phrase and not an empty space: an empty attribute line where others have one
  is a signal.

### 5.3 Cheap computation at read time

The read path performs **zero counts and zero joins**. Three pieces:

1. **Cohort count projection**, maintained by the identity service: key is the generalisation
   tuple, value is the count. Cardinality is tiny — roughly (universities × faculties × years) plus
   the coarser levels; a few hundred rows now, low thousands at national scale. It fits in process
   memory and is refreshed on a timer.
2. **Per-user rendered labels**, materialised on the *public* profile projection: for each surface,
   the already-generalised label string plus the level that produced it. Computed by the identity
   service in the batch job (5.5), never at request time.
3. **Read path** = fetch the public projection row and emit the stored string. The sealed store is
   not consulted, the count projection is not consulted, and no aggregate is computed.

The cohort counts are **never exposed to clients** in any form — not as a number, not as a
"you are one of N" hint, not in an error message (assertion 23). Publishing the count publishes
the size of the anonymity set, which is the input to the attack the floor exists to prevent.

### 5.4 Two special cases

**Tier badge (T15).** The `KART` badge partitions the population. When
`count(card-verified users in the rendered scope) < 20`, the `KART` badge is replaced platform-wide
**for that whole scope** by the neutral `DOĞRULANMIŞ` label. It must be a scope-wide switch, never
per-user: suppressing the badge for the rare users and showing it for the common ones would make
suppression itself the signal.

**Boards.** A board's *eligible membership* is a cohort. A university-scoped board whose eligible
population is below 20 must not exist as a separate board — it is merged into a cross-university
board. Follower counts are rendered only above 1,000 (the design's `9 214` is fine); below that the
count is hidden rather than rounded, because a rounded count still moves.

### 5.5 Recomputation schedule — why batching is a security control

The naive implementation recomputes a user's level when their verification lands. That is a leak:
an observer watching a cohort sitting at 19 sees the labels for *everyone* in that cohort change
the moment a 20th person verifies. That reveals both that a new person joined and precisely when.

Therefore:

- **All levels are recomputed and applied in a single daily batch**, atomically, at a time that is
  randomised within a window. Every cohort transition in the system becomes simultaneous and
  unattributable.
- **Revealing requires stability:** a cohort must measure ≥ 20 in **two consecutive daily
  snapshots** before its members are rendered at the finer level. This absorbs single-day noise and
  removes the "verify, observe, unverify" probe.
- **Coarsening is applied at the next batch** with no stability requirement — when a cohort drops
  below 20 (graduations, expiries), privacy tightens at the first opportunity.
- Do **not** use hysteresis (reveal at 20, hide at 17): it renders cohorts of 17–19, which the
  brief forbids. Batch atomicity, not hysteresis, is the anti-flapping mechanism.
- Bulk verification events (a university onboarding, a migration) trigger an off-schedule batch,
  which is safe because it moves many cohorts at once.

---

## 6. One person, one account

### 6.1 The credential hash — a correction to the brief's wording

The brief says "salted credential hash". Taken literally with a *per-row random salt*, uniqueness
cannot be enforced: you cannot look up a value you cannot recompute. The construction that
actually delivers the invariant is a **keyed hash with a single global secret (a pepper)**:

```
credential_hash = HMAC-SHA256(K_cred_v, domain_tag ‖ normalize(credential))
```

- `K_cred_v` is a ≥256-bit secret held in KMS/Vault, **never in the database**, versioned by `v`.
  A database dump alone cannot be brute-forced back to email addresses (the address space of
  `ad.soyad@std.bsu.edu.az` is small and would fall to an unkeyed hash in minutes).
- `domain_tag` separates credential types (`email`, `student_id`) so an email and a student ID that
  happen to normalise identically cannot collide.
- The store must guarantee **uniqueness of `credential_hash`** across all accounts, live and
  banned. This uniqueness constraint *is* the one-person-one-account invariant; everything else is
  process.
- The hash version is stored alongside the value. Key rotation runs as a dual-write window: new
  credentials hash under `v+1`, lookups check `v` and `v+1`, and a migration re-hashes as users
  re-verify. Old-key values that never re-verify are retained under the old version indefinitely.
- One account may hold **several** credentials (an email plus a student ID plus, after re-enrolment,
  a second email). The invariant is *credential → at most one account*, not *account → one
  credential*.

### 6.2 Normalisation — including the Azerbaijani casing trap

`normalize()` for an email credential:

1. Trim whitespace; reject anything containing a control character.
2. Apply **NFKC**.
3. Lowercase using an **invariant/ordinal** mapping.
4. Split at the last `@`; the domain is lowercased and must match the university's allowlist.
5. Local-part handling is **per-university configuration**, defaulting to *no* modification. Do not
   strip dots and do not strip `+tags` by default: for Microsoft Exchange deployments (which most
   Azerbaijani universities run) `ad.soyad@` and `adsoyad@` are different mailboxes, and stripping
   dots would merge two real students into one account. Where a university's mail platform is known
   to alias, that is recorded as configuration, not assumed.

> **The casing trap.** In Azerbaijani and Turkish locales, `"I".toLowerCase()` yields `ı`
> (dotless i), not `i`. A device running in `az-AZ` — which is every target device — that
> lowercases the credential locale-sensitively will produce a *different* hash for
> `AI.Soyad@…` than a server running in `en-US`, and the same user will be able to create two
> accounts, or will be locked out of their own. The identical hazard applies to handle comparison.
> **Every casing operation on identity material must be locale-invariant, on both client and
> server, and must be covered by an explicit test (assertion 30).**
> Note that `Aİ.Soyad@` (dotted capital İ) and `ai.soyad@` are genuinely different strings and must
> *not* collide — the test needs both directions.

`normalize()` for a student ID: NFKC, uppercase invariantly, strip separators declared in the
university's configuration, then validate against that university's ID format.

### 6.3 What stops re-registration after a ban

- On ban, **every credential ever bound to the account is retained in a ban set**, keyed by
  `credential_hash`, independent of the account's own lifecycle. Deleting the account does not
  remove them.
- A registration attempt whose credential hash is in the ban set is refused **after OTP success**
  (§2.1 anti-enumeration ordering) with a generic message and an appeal link. The response is
  byte-identical to the "already registered" response (assertion 31), so the flow cannot be used to
  test whether a given address belongs to a banned account.
- **"Delete my account" retains a credential tombstone.** The user's content, handle, karma and
  sealed attributes are purged; the credential hashes and the ban state remain. This is a real
  tension with data-subject erasure rights under Azerbaijani data protection law and needs a legal
  decision — flagged.
- **App attestation** (Play Integrity / App Attest) gates account creation and raises the cost of
  farming, but is **never the sole basis** for refusing an account: device signals are weak,
  privacy-invasive, and collide on shared and refurbished hardware.
- **Address recycling caveat.** Some universities reissue `ad.soyad@` to a later student with the
  same name. A permanent email-based ban would then block an innocent namesake. Mitigations:
  prefer the **student-ID** credential as the anchor for permanent bans; store a first-seen
  timestamp with each credential; and make the appeal path able to release an email hash from the
  ban set while keeping the student-ID hash banned. Whether the four launch universities recycle
  addresses is an open question and must be answered per university.

### 6.4 Legitimate re-enrolment and changed student IDs

The rule: **credentials are added to an existing account from an authenticated session; a new
credential never creates a second account for a person who already has one.**

| Situation | Path |
|---|---|
| Bachelor → master's at the same university, new email | Signed in, run route A with the new address. It is *added*; a new sealed identity epoch (entry year, programme) is appended, not overwritten — study year and k-anonymity depend on the current epoch. Tier restored. Handle, karma, blocks unchanged. |
| Transfer to another university | Same: add the credential, append an epoch with the new university. The public projection re-renders at the next batch. Whether history follows the user across universities is a product question — flagged. |
| Card reissued with a new student ID | Signed in, run route B. The new ID hash is added; the old is retained (it still matters for ban enforcement). |
| Lost access to the university mailbox and not signed in | No self-service path. Manual appeal: route B card submission plus a reviewer consistency check against the sealed record. On success the account is re-bound. This is deliberately slow. |
| Graduate returning to study | Same as re-enrolment; tier moves `graduate` → `email`/`card` on the new credential. |
| Presenting a credential already bound to another account | Always refused. Never merge accounts automatically — an automatic merge is a de-anonymisation primitive (it would let an attacker who obtains one credential absorb another person's pseudonymous history). |

Sealed identity records are **append-only epochs**, never updates. Overwriting entry year or
faculty would silently move a user between k-anonymity cohorts and would destroy the audit trail
that the legal-request path depends on.

---

## 7. Token and claim design (Supabase Auth)

### 7.1 What goes in the access token

Custom claims are injected by the `custom_access_token_hook`. The hook is `SECURITY DEFINER`, owned
by a role whose only reachable object is a **minimal claims projection**. The hook must not be able
to read the sealed store — if it can, every token mint is a sealed-store read.

| Claim | Type | Why it is safe and why it is needed |
|---|---|---|
| `sub` | uuid | Supabase auth subject. Opaque. |
| `app_user_id` | uuid v4 | Needed by every row-level policy on non-identity tables. |
| `tier` | enum `provisional\|email\|card\|graduate\|expired` | Badge rendering and write gating on every request. |
| `role` | enum `student\|moderator\|admin` | Coarse capability. Per-board moderator scope is **not** in the token (board assignments change); it is looked up server-side. |
| `univ_id` | uuid | Every read is university-scoped; refetching it per request is the single largest avoidable cost. It is identity-adjacent but not identifying — the smallest launch university still has thousands of students. |
| `epoch` | int | Monotonic per user; the revocation primitive (§7.3). |
| `sid` | uuid | Per-session id for targeted revocation and for correlating logs without a user identifier. |

That is the complete list. Anything not on it is not in the token.

### 7.2 What must never be in the token

Real name; email address; phone; student ID; **faculty**; **entry year**; **study year**;
expected graduation date; **handle**; karma; any `career_profile` identifier or `subject_ref`;
verification evidence references; device identifiers; the k-anonymity level.

Reasons, specifically:

- **The handle is excluded** for three reasons: it changes (a stale token would render the previous
  handle, which is a rename oracle); it would appear in every access log, gateway log and APM trace
  that captures the bearer token, creating a permanent token↔pseudonym index; and it is never
  needed for authorisation.
- **Faculty and entry year are excluded** because they are exactly the attributes the k-anonymity
  floor exists to generalise. Putting them in a client-readable, device-stored, log-leaking token
  bypasses the floor entirely.
- **The k-anonymity level is excluded** because it encodes "you are in a small cohort", which is a
  hint about the user's rarity.

**Two Supabase-specific traps, both of which are the default behaviour:**

1. **`auth.users.email` is serialised into the access token.** If the university email is used as
   the Supabase auth email, then the token — held on the device, sent to every service, present in
   logs — carries the identity credential. **The university email must never be the Supabase auth
   email.** The verification service owns the address; the auth user is created with an opaque
   internal identifier (`<uuid>@users.kiksu.invalid` or an anonymous sign-in linked to a device
   credential). The address itself lives only in the sealed store, as a keyed hash plus an
   encrypted value. Assertion 32.
2. **`raw_user_meta_data` (`user_metadata`) is client-writable** through the standard update-user
   call and it lands in the JWT. It must never be read for any authorisation decision, and tier
   must never be stored there. Server-controlled claims go in `app_metadata` or are computed by the
   hook. A policy that trusts `user_metadata.tier` grants every user the ability to award themselves
   the `KART` badge.

### 7.3 Refresh, revocation, and tier change

- **Access token TTL: 900 s.** Short enough that a stale tier self-heals quickly, long enough to
  avoid refresh storms. **Refresh token rotation on, with reuse detection** (a replayed refresh
  token revokes the whole family).
- **`epoch`** is incremented on: tier grant, tier expiry, graduation transition, suspension, ban,
  unban, role change, and forced logout. It is the single revocation signal.
- **On ban or suspension**, additionally: revoke all refresh tokens for the subject through the
  admin API, so refresh itself fails rather than minting a fresh valid token.
- **Effective revocation latency target: ≤ 60 s**, and in practice sub-second via the epoch check
  below.
- **Downgrades at expiry** are applied by the scheduled job that owns §2.4, which bumps `epoch` as
  part of the same transaction as the tier change.

### 7.4 Authorising without refetching identity

The hot path performs **one integer comparison**, not an identity fetch:

1. Verify the JWT signature (stateless).
2. Read `epoch` for `app_user_id` from a hot cache — in-process LRU fronting Redis, invalidated by
   Postgres `LISTEN/NOTIFY` on epoch bumps. A hit is sub-microsecond; a miss is one indexed lookup.
3. If `token.epoch < current.epoch` → `401 token_stale`. The client refreshes silently, the hook
   mints correct claims, the request retries. This is how a ban takes effect in under a second
   without any per-request identity read.
4. Otherwise authorise from the token claims alone: ownership via `app_user_id`, write gating via
   `tier`, scoping via `univ_id`, moderation via `role` plus a server-side board-scope lookup.

Row-level policies use a `STABLE` helper wrapping
`(auth.jwt() -> 'app_metadata' ->> 'app_user_id')::uuid` so the planner can use it as a constant and
still hit indexes. Policies must never call anything that reads the sealed store.

**The read-volume budget is a control, not a metric.** In steady state the sealed store should see
on the order of tens of reads per day (verification grants, moderation escalations, legal requests).
A dashboard and an alarm on that number is the cheapest possible detector for someone having wired
identity into a hot path — it fires long before anyone notices in code review.

---

## 8. Anonymity regression test suite

These are the tests that must fail loudly when someone later adds a convenient join. Each is a
checkable assertion, implementable without further design decisions. They are grouped by how they
run, not by importance. Every one of them is a release blocker.

### A. Static / schema assertions (run in CI against migrations and source)

1. **No cross-layer foreign keys.** No foreign key constraint has one side in the sealed identity
   schema and the other outside it. Same assertion for the career schema. Query `pg_constraint` for
   `contype = 'f'` and assert the schema pair is never mixed.
2. **Sealed-store join lint.** No file outside `services/verification/**` and `services/legal/**`
   contains both the sealed-identity table identifier and the `app_user` identifier. Applies to
   `.sql`, `.ts`, migrations, seeds, fixtures, analytics queries and BI definitions.
3. **Career join lint — zero exceptions.** No file anywhere in the repository contains both the
   `career_profile` identifier and the `app_user` identifier. No allowlist exists for this one.
4. **No client grants on sealed schemas.** For every table in the identity and career schemas,
   `has_table_privilege` returns false for `anon` and for `authenticated` on SELECT, INSERT,
   UPDATE, DELETE, TRUNCATE and REFERENCES. Assert over `information_schema`, not over the
   migration text.
5. **RLS enabled everywhere it matters.** Every table in the identity, career, alias-map and
   moderation schemas has `relrowsecurity = true` and has no permissive policy whose role list
   includes `authenticated` or `public`.
6. **No transitive exposure.** Walk `pg_depend` recursively from every view, materialised view and
   function reachable by `authenticated`; assert none depends on a table in the identity, career,
   alias-map or moderation schemas.
7. **Forum projection column allowlist.** Snapshot the exact column list returned by every
   client-facing forum view/RPC and assert it contains no column named or aliased `app_user_id`,
   `user_id`, `author_id`, `handle`, `email`, `student_id`, or a raw `created_at`. The snapshot is
   committed; changing it requires an explicit review.
8. **All exposed ids are UUIDv4.** Sample 1,000 identifiers of every externally exposed type and
   assert version nibble `4` and correct variant bits. Explicitly fails for UUIDv1, UUIDv7, ULID
   and integer sequences.
9. **Wordlist integrity.** The adjective and noun lists match their committed checksums; no two
   entries share a Unicode confusable skeleton; no entry appears on the multilingual word denylist;
   `|ADJ| × |NOUN| × 90 ≥ 6,000,000`.

### B. Thread alias correctness and concurrency

10. **Injective and functional.** Within a thread, ordinal → user is injective and user → ordinal
    is a function. Property test: 100 random interleavings of 20 users × 5 comments each.
11. **Same user, same ordinal.** A user commenting three times in one thread renders the same
    ordinal on all three.
12. **Concurrent allocation is dense and duplicate-free.** 50 distinct users post concurrently into
    one empty thread; the resulting ordinal set is exactly `{1..50}`. Repeat 20 times.
13. **Abandoned previews leave no permanent gap.** 10 users call preview, 3 post, hold TTL elapses,
    sweep runs; the thread renders ordinals `{1,2,3}` and nothing else.
14. **Preview honesty within TTL.** A preview issued at `t` and consumed at `t + TTL − 1 s` yields
    the previewed ordinal. Consumed at `t + TTL + 1 s` it may yield a different ordinal, but never
    one already present on published content.
15. **Author is ordinal 1.** For every thread in a large generated fixture, the thread author's
    ordinal is 1.
16. **Ordinals never reused across threads.** For any user appearing in ≥ 30 threads, the
    distribution of their ordinals is not constant and is consistent with independent per-thread
    allocation (a chi-square test against the expected distribution, or minimally: assert the
    ordinal is not a function of the user id alone).
17. **Alias is not an input anywhere.** Fuzz every route by substituting a thread alias
    (`"ANONİM 3"`, `3`) wherever an identifier is expected; assert every response is 4xx and no
    response body contains a handle or an `app_user_id`.
18. **Rollback frees the ordinal.** Force the content insert to fail after allocation; assert the
    ordinal is available to the next allocator and no alias-map row survives.
19. **Deleted comments keep their ordinal.** Deleting a comment renders `silinib` in place; the
    surrounding ordinals do not renumber.
20. **Cold-thread erasure.** After the configured cold period, the alias-map rows for that thread
    are absent while the ordinals on the content rows are unchanged.

### C. Cross-surface linkage

21. **No surface renders both layers.** For every client-facing endpoint, assert the response never
    contains both a thread-alias field and a handle field.
22. **Karma is not an oracle.** Award 1 karma to user X; assert the response of the public profile
    endpoint for X is byte-identical before and after, except within the daily refresh window.
23. **Karma-delta simulation.** Poll a target's public profile every minute for a simulated 24 h
    while the target receives 200 votes across 5 posts; assert an attacker script cannot attribute
    any individual post (formally: the profile response takes at most one distinct value per day).
24. **Block is surface-scoped.** Block user X from a forum thread; assert X's marketplace listings
    remain visible and X's seller profile is unchanged. Assert a global block is reachable only
    from a handle-bearing surface.
25. **Report de-duplication is silent.** Reporting the same content twice returns an identical body
    and status to reporting it once.
26. **Career silo — no shared values.** Across a full fixture database, no HTTP response, no log
    line and no database row contains both a `career_profile` identifier and an `app_user_id`.
27. **Career silo — automated linkage attempt.** Given a full database dump without `K_career`,
    run an automated equality-join search across every column pair between career tables and app
    tables; assert no pair matches more than 1% of rows. Include a timestamp-proximity join
    (career `created_at` vs `app_user` events) and assert career timestamps have day granularity.
28. **Storage keys carry no identity.** Upload two images as the same user; assert the object keys
    are ≥128 bits of randomness, share no prefix, and contain no user id, handle or thread id.
    Assert the career bucket is a distinct bucket with a distinct policy and an unrelated key scheme.
29. **Media metadata is destroyed.** Upload a JPEG carrying GPS EXIF, a maker note and an embedded
    EXIF thumbnail; assert the stored object contains none of the three and that the bytes differ
    from a naive tag-strip of the original (i.e. it was re-encoded).
30. **Realtime leaks nothing.** Subscribe to a thread channel as user A while user B posts; assert
    the presence state is empty, every broadcast payload matches the REST projection schema exactly,
    and `postgres_changes` on forum, marketplace and identity tables is unavailable to
    `authenticated`.
31. **Timetable sharing is free/busy only.** With sharing enabled for A and B, assert the response
    contains only interval boundaries on a ≥30-minute grid and no course id, code, room, instructor
    or credit value; assert bulk fetch beyond the configured cap returns 429.
32. **Log hygiene.** Run the full integration suite with log capture at every level; assert no log
    line contains a handle, an email address, a student ID, a JWT, or an `app_user_id` co-occurring
    with a thread alias or a content id.

### D. k-anonymity

33. **Exhaustive floor check.** For every user in a full fixture database, the rendered attribute
    tuple on every surface either has `Cohort ≥ 20` or is a strict generalisation of the user's
    true tuple along that surface's declared descent path.
34. **Boundary behaviour and batching.** Seed a cohort of 19; assert the marketplace line renders
    L2. Add a 20th member; assert it still renders L2 until the batch job has run **twice**; then
    assert L1. Remove a member; assert it returns to L2 at the next single batch run.
35. **Counts are never exposed.** No client response, error message, header or debug field contains
    a cohort count.
36. **Fallback is uniform.** Every user at L5 renders the identical string `Doğrulanmış tələbə`;
    no user renders an empty attribute line.
37. **Tier badge floor.** Seed a university with 12 card-verified users; assert no post from that
    university renders `KART`, and that the substitution is scope-wide (all 12, not a subset).
38. **Denominator includes opted-out users.** With 25 users in a cohort of whom 3 have the display
    toggle on, assert the cohort count used is 25 and the 3 render at L1.
39. **Graduates counted separately.** Moving users to `graduate` reduces the current-student cohort
    count and can trigger coarsening; assert it does.
40. **Review cohort threshold.** A `(course, instructor, semester)` with fewer reviews than
    `k_review` renders the aggregate rolled up to all-semesters and omits the semester label from
    individual written reviews.

### E. Handles, credentials and enumeration

41. **Handle search cannot enumerate.** Prefix, substring, fuzzy and wildcard queries return zero
    results; only exact full-handle matches resolve; the response body for "does not exist" and for
    "exists but not searchable" is byte-identical and their response times are within 2σ; the
    endpoint returns 429 past its rate limit; the feature is off by default for new accounts.
42. **Handle generation is random, not derived.** Generate 1,000,000 handles: zero duplicates after
    retry; uniform distribution across adjective and noun positions (chi-square); no handle appears
    in the denied-pair set or uses a denied number; and the id→handle mapping is **not** reproducible
    from any fixed seed plus the user id (regenerate with the same ids and assert the outputs differ).
43. **Occupancy alarm fires.** Simulate ρ = 0.25 and assert the mean retry counter crosses the
    threshold and the overflow band engages.
44. **Rename propagates atomically.** After a rename: every surface renders the new handle in the
    same read-after-write; no API returns the previous handle; the previous handle is unresolvable
    and unavailable for reissue for 365 days.
45. **Rename does not break enforcement.** An existing block still suppresses the renamed user's
    content; an active suspension still applies; a marketplace complaint counter is unchanged.
46. **Block list is not a rename oracle.** After the blocked user renames, the blocker's block list
    still shows the handle as it was at block time, and unblocking by entry id still works.
47. **Rename cooldown is server-enforced.** A second rename within 14 days is refused at the API
    even when called directly; a forced rename bypasses the cooldown and starts a fresh window.
48. **Casing and normalisation.** `AI.Soyad@std.bsu.edu.az` and `ai.soyad@std.bsu.edu.az` produce
    the same credential hash and the second registration is refused. `Aİ.Soyad@std.bsu.edu.az`
    (dotted capital İ) produces a **different** hash. Run the test with the process locale forced to
    `az-AZ` and again with `en-US`; the hashes must match across both runs.
49. **Ban survives deletion.** Ban a user, delete the account, re-register with the same credential;
    assert refusal and assert the response is byte-identical to the already-registered response.
50. **Credentials add, never fork.** From an authenticated session, verifying a second credential
    attaches it to the existing account, preserves handle/karma/blocks, and appends a sealed epoch
    rather than overwriting one. Presenting a credential bound to a *different* account is refused
    and never merges.

### F. Verification, tokens and SLAs

51. **JWT claim allowlist.** Decode a live access token; assert the claim set is exactly the §7.1
    allowlist; assert `email`, `phone` and `user_metadata` are absent or empty; assert no claim
    value appears anywhere in the sealed store.
52. **`user_metadata` is never trusted.** Set `user_metadata.tier = 'card'` through the client SDK;
    assert the rendered badge and every write gate are unchanged.
53. **Revocation latency.** Change a user's tier; assert a request bearing the pre-change token is
    rejected or downgraded within 60 s without any client-initiated refresh. Ban a user; assert the
    refresh call itself fails.
54. **Sealed-store read budget.** Run the full integration suite; assert the sealed store read
    counter stays under the configured budget and that every read is attributable to the
    verification, moderation-resolver or legal service.
55. **Moderation queue leaks nothing.** The queue payload for a case contains no handle, no
    `app_user_id`, no karma, no post count and no university; the subject label for the same user
    differs across two distinct cases; the prior-sanction signal is a bare integer.
56. **Moderation audit rows do not join.** Dump the audit rows for one user across three cases;
    assert no value repeats across the three rows other than action enums and timestamps.
57. **Email OTP SLA.** A synthetic probe per university domain asserts p95 (submit → badge) ≤ 120 s
    over a rolling hour, and asserts that exceeding it flips the onboarding copy off the
    `2 dəqiqə` claim.
58. **Card review SLA.** Assert 99% of queued submissions reach a terminal state or an escalation
    plus user notification within 24 h; assert no code path grants `card` tier on timeout; assert
    the `24 saata qədər` copy is flag-gated on the measured percentile.
59. **OTP hardening.** Assert 10-minute TTL, burn after 5 wrong attempts, 60 s resend cooldown, and
    that the pre-OTP response is identical for a fresh address, an already-registered address and a
    banned address.
60. **Invite code hardening.** Assert single use, 72 h expiry, university scoping, live-code
    population cap, device lockout by the 11th failure, and identical bodies and timings for wrong /
    expired / consumed / wrong-university.
61. **Provisional tier is limited and expires.** Assert a `provisional` account renders no tier
    badge, is capped at its daily post limit, cannot list on the marketplace, cannot write reviews,
    cannot issue invites, and reverts to read-only with its posts hidden after 7 days.
62. **Expiry and graduation transitions.** Advance the clock past `valid_until`: assert the badge
    disappears, posting is refused with the correct error, content is retained, and `epoch` bumped.
    Advance to graduation + 12 months: assert the tier becomes `graduate` and every
    graduate-restricted surface returns 403.
63. **Card images are destroyed.** Assert every approved or rejected submission's raw image is
    absent from storage within 24 h of the decision, and that the retained record contains a
    decision, reason codes, a reviewer id, a perceptual hash and a keyed student-ID hash — and no
    image.
64. **Invite graph is not queryable.** Assert no client-facing endpoint returns an inviter or
    invitee relationship, and that pairs older than 30 days have been reduced to aggregates.

---

## Open questions

Identity semantics the brief does not settle. **These must be answered before implementation;
none should be guessed at.**

**Tiers and badges**

1. **Is the badge-less comment (`ANONİM 3`, screen 06) the invite tier?** This spec assumes yes.
   The alternative reading is that it is a rendering variant with no semantic content. If invite-tier
   users are badge-less, readers cannot distinguish "unverified" from "verified but the badge did
   not render", which is arguably worse than a distinct low-tier badge.
2. **Graduate badge and permissions.** The design has no graduate state. `MƏZUN` is proposed. What
   exactly may a graduate do — post in course boards? write reviews of courses they took? keep
   selling? Their presence also affects k-anonymity denominators (§5.1).
3. **Does `card` tier confer anything beyond the badge?** The design implies elevated marketplace
   trust. If marketplace listing requires `card`, that is a significant anonymity/trust trade the
   brief does not state.
4. **Invite tier expiry behaviour.** §2.3 proposes hiding (not deleting) a provisional user's posts
   when the 7-day window lapses. This is a product call with moderation consequences.

**Rendering conflicts with the design**

5. **Relative-time granularity.** The design renders `25 dəq` and `40 dəq`. §1/T9 recommends coarser
   buckets, which changes UI copy. Which wins?
6. **Board list alias chips.** Screen 05 shows `A1`, `A7`, `A3` as the chips for three thread
   authors, but screen 06 shows the thread author as `ANONİM 1`. If the author is always ordinal 1,
   the board list should always show `A1`. Is the board chip the author's alias, a decorative
   avatar, or something else? If it is decorative but *derived* from the user, it is a cross-thread
   correlation vector and must be changed.
7. **Is the profile screen (10) viewable by other users, or self-only?** The whole karma-oracle
   analysis (T5) depends on this. If profiles are public by handle, karma and post count must be
   bucketed or removed.
8. **Default state of each privacy toggle.** The five toggles on screen 10 are rendered identically
   in the design markup, so the intended defaults are unreadable. This spec assumes
   `Axtarışda tapılım` defaults **off**; the other four need explicit decisions, and each default
   is a privacy decision, not a UX one.

**k-anonymity**

9. **`k_review` for course/instructor/semester cohorts.** Applying k = 20 to reviews would suppress
   most of them. §1/T17 proposes 5. This needs an explicit product ruling, and it is a genuine
   weakening of the brief's invariant for one surface.
10. **Is `2-Cİ KURS` derived from the sealed entry year, or self-declared?** If self-declared it is
    not a sealed attribute, the k-anonymity treatment differs, and it can be falsified — which
    changes what the marketplace line means.
11. **Faculty granularity.** Is `İNFORMATİKA` a faculty, a department or a programme? Cohort sizes
    differ by an order of magnitude between them, and the descent path in §5.2 depends on the answer.
12. **Is there a cross-university (national) board?** If yes, university is no longer the coarsest
    level and L5 needs to be reachable from a national scope too.

**Aliases**

13. **Cold-thread alias erasure at 90 days** (§3.6.5) permanently breaks "same person, same ordinal"
    for old threads and breaks retrospective moderation of old content. Is the privacy gain worth
    both? What is the correct cold period?
14. **Does the `MÜƏLLİF` marker appear on the author's comments as well as the original post?** If
    it does, and the author also comments, the marker links ordinal 1 to those comments — which is
    intended, but it should be a stated decision.

**Credentials, bans and law**

15. **Do the four launch universities recycle email addresses** between students? This determines
    whether an email hash is a safe anchor for a permanent ban (§6.3).
16. **Per-university local-part semantics** — does any of BDU / ADA / UNEC / BMU alias dots or plus
    tags? Getting this wrong either merges two students or lets one person hold two accounts.
17. **Account deletion vs. ban-tombstone retention** under Azerbaijani data protection law. §6.3
    retains credential hashes after deletion; that needs a legal basis and a stated retention period.
18. **Legal-request policy.** What process unseals `verified_identity`, who authorises it, what is
    logged, and is the user notified? The sealed layer exists for this path and it is currently
    undefined.
19. **Verification evidence retention.** §2.2 proposes deleting card images within 24 h of the
    decision (30-day cap for appeals). Confirm against any regulatory obligation to retain evidence.

**Moderation**

20. **Are moderators students (peers) or staff?** Peer moderators with access to a resolver — even a
    case-scoped one — is a materially different threat model, and it changes whether the resolver
    should exist at the moderator tier at all or only at a staff escalation tier.
21. **What sanctions exist**, how do they map onto tiers, and are they visible to the sanctioned
    user? An invisible sanction (shadow-limiting) has different anonymity properties from a visible
    one.

**Cross-cutting**

22. **Push notifications.** Which service owns device tokens, and is the career service permitted to
    send any notification at all? A shared token registry is a career↔pseudonym join (T3b).
23. **Transfer students and dual enrolment.** Does forum history, karma and marketplace reputation
    follow a user across universities (§6.4)? Carrying it across is a linkage signal to observers at
    both institutions.
24. **Tunable thresholds needing product sign-off:** invite issuance requirements (age ≥ 14 days,
    karma ≥ 20), provisional posting limit (3/day), invite live-code cap (2,000), hold TTL (5 min,
    30 min max), handle quarantine (365 days).
