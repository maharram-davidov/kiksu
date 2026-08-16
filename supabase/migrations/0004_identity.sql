-- =====================================================================
-- 06. IDENTITY — LAYER 1, SEALED
--
-- Nothing in this schema is ever rendered in a user-facing surface.
-- Nothing outside the verification and legal-request services may read
-- it. The controls, in order of strength:
--
--   1. Schema is owned by kiksu_identity_owner and USAGE is granted only
--      to kiksu_identity_svc. anon, authenticated and service_role have
--      no USAGE — the Supabase service key cannot reach this schema.
--   2. Not listed in PostgREST `db-schemas`, so no HTTP surface exists.
--   3. RLS is ENABLED *and* FORCED on every table, so even the owning
--      role is subject to policy. The policy on the linking table only
--      passes when a transaction-local GUC is set.
--   4. The only thing that sets that GUC is identity.unseal(), a
--      SECURITY DEFINER function that writes identity.access_log FIRST
--      and requires a declared purpose (and, for legal purposes, an
--      approved identity.legal_request row).
--   5. identity.access_log is append-only, enforced by trigger.
--
-- Residual risk that the database cannot close: a superuser or a role
-- with BYPASSRLS (Supabase's `postgres` role has it) can read anything.
-- That is a platform-access-control problem, documented in the notes.
--
-- THE AUTH ANCHOR RULE
-- auth.users must NOT contain the university email. If it did, the
-- trivially joinable path app_user -> auth.users -> email would leak
-- 'ad.soyad@std.bsu.edu.az' — i.e. the student's real name — and the
-- whole four-layer model would be decorative. Accounts are created with
-- a synthetic address (<uuid>@users.kiksu.app) or phone; the university
-- email is submitted to the verification service, reduced to an HMAC in
-- identity.credential_binding, and the plaintext is discarded once the
-- confirmation link is consumed. identity.auth_email_leak_check exists
-- to make a regression here loud.
-- =====================================================================

-- --------------------------------------------------------------------
-- 06.1 Subject — one row per verified human being
--
-- subject_key = HMAC-SHA256(pepper_identity, 'kiksu:identity:v1' || auth_uid)
-- computed by the verification service. The pepper lives in the service's
-- KMS/secret store, NEVER in this database (that includes Supabase Vault,
-- which is in-database). Consequence: a full dump of Postgres does not
-- let the reader map a subject back to an auth account.
-- --------------------------------------------------------------------
create table identity.subject (
  id              uuid primary key default util.uuid_v7(),
  subject_key     bytea not null,
  key_version     smallint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint subject_key_uniq unique (subject_key),
  constraint subject_key_len  check (octet_length(subject_key) = 32)
);

comment on column identity.subject.subject_key is
  'HMAC(auth uid) under a pepper held outside the database. There is deliberately no auth.users FK: the mapping must not be recomputable from a database dump alone.';

-- --------------------------------------------------------------------
-- 06.2 Verified identity — the sealed attribute set
-- --------------------------------------------------------------------
create table identity.verified_identity (
  id                    uuid primary key default util.uuid_v7(),
  subject_id            uuid not null references identity.subject(id) on delete restrict,

  university_id         uuid not null references ref.university(id),
  faculty_id            uuid references ref.faculty(id),
  program_id            uuid references ref.program(id),
  entry_year            smallint check (entry_year between 1990 and 2100),
  expected_graduation_year smallint check (expected_graduation_year between 1990 and 2100),
  degree_level          text check (degree_level in ('bachelor', 'master', 'phd', 'preparatory')),

  -- PII: ciphertext produced by the verification service with an envelope
  -- key from an external KMS. The database stores bytes it cannot read.
  legal_name_ct         bytea,
  legal_name_kid        text,
  student_number_hmac   bytea,

  tier                  public.verification_tier not null default 'unverified',
  state                 identity.verification_state not null default 'none',
  method                public.verification_method,

  verified_at           timestamptz,
  expires_at            timestamptz,                        -- re-verification cadence
  revoked_at            timestamptz,
  revocation_reason     text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint verified_identity_subject_uniq unique (subject_id),
  constraint verified_identity_tier_ck check (
    (tier = 'unverified') or (state = 'verified' and verified_at is not null)
  )
);
create index verified_identity_cohort_idx
  on identity.verified_identity (university_id, faculty_id, program_id, entry_year)
  where state = 'verified';

comment on table identity.verified_identity is
  'LAYER 1. Never rendered. The only thing that leaves this schema is (a) a coarse, k-anonymity-checked projection onto public.app_user and (b) aggregate counts in public.cohort_size.';

-- --------------------------------------------------------------------
-- 06.3 Credential binding — "one verified person = one app_user"
--
-- The unique index on (kind, credential_hmac) is the structural version
-- of invariant I4: the same university email / student number cannot
-- produce a second subject. Salt is per-credential-kind and peppered
-- outside the DB, so the table is not a rainbow-table target.
-- --------------------------------------------------------------------
create table identity.credential_binding (
  id                 uuid primary key default util.uuid_v7(),
  subject_id         uuid not null references identity.subject(id) on delete restrict,
  kind               identity.credential_kind not null,
  credential_hmac    bytea not null,
  key_version        smallint not null default 1,
  university_id      uuid references ref.university(id),
  first_seen_at      timestamptz not null default now(),
  last_verified_at   timestamptz,
  released_at        timestamptz,                            -- graduation / account erasure
  constraint credential_binding_uniq unique (kind, credential_hmac),
  constraint credential_hmac_len check (octet_length(credential_hmac) = 32)
);
create index credential_binding_subject_idx on identity.credential_binding (subject_id);

-- --------------------------------------------------------------------
-- 06.4 Verification attempts (the state machine's storage)
-- The state machine itself is the Identity Architect's deliverable. This
-- table only has to be able to hold it: one row per attempt, an SLA
-- deadline (2 minutes for email, 24h for card review), evidence pointer,
-- reviewer decision, and abuse counters.
-- --------------------------------------------------------------------
create table identity.verification_attempt (
  id                  uuid primary key default util.uuid_v7(),
  subject_id          uuid references identity.subject(id) on delete cascade,
  auth_user_id_hmac   bytea,                                 -- for pre-subject attempts
  university_id       uuid not null references ref.university(id),
  method              public.verification_method not null,
  state               identity.verification_state not null default 'pending',

  -- Evidence lives in a PRIVATE storage bucket. We keep the path plus a
  -- content hash so tampering is detectable, and a purge deadline.
  evidence_path       text,
  evidence_sha256     bytea,
  evidence_purge_at   timestamptz,

  challenge_hmac      bytea,                                 -- emailed token / 6-digit code
  challenge_expires_at timestamptz,
  attempt_count       smallint not null default 0,
  sla_due_at          timestamptz,

  decided_at          timestamptz,
  decided_by_staff_id uuid,                                  -- moderation.staff.id, intentionally no FK
  decision            text check (decision in ('approved', 'rejected', 'needs_more_info')),
  reject_reason_code  text,

  -- Abuse signals, hashed. Never store raw IP or UA in this schema.
  ip_hmac             bytea,
  user_agent_hmac     bytea,
  device_hmac         bytea,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index verification_attempt_queue_idx
  on identity.verification_attempt (state, sla_due_at)
  where state in ('pending', 'in_review');
create index verification_attempt_subject_idx on identity.verification_attempt (subject_id, created_at desc);
create index verification_attempt_device_idx  on identity.verification_attempt (device_hmac) where device_hmac is not null;

-- Invite codes: 6 digits, issued by an already-verified student.
create table identity.invite_code (
  id                 uuid primary key default util.uuid_v7(),
  code_hmac          bytea not null unique,
  issuer_subject_id  uuid not null references identity.subject(id) on delete cascade,
  university_id      uuid not null references ref.university(id),
  max_uses           smallint not null default 1 check (max_uses > 0),
  used_count         smallint not null default 0,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  constraint invite_code_uses_ck check (used_count <= max_uses)
);
create index invite_code_issuer_idx on identity.invite_code (issuer_subject_id);

-- --------------------------------------------------------------------
-- 06.5 THE SEALED LINK
--
-- This is the single most dangerous table in the product. It is the only
-- place where "which pseudonym belongs to which verified student" is
-- written down.
--
-- Deliberate design choices:
--   * app_user_id has NO FOREIGN KEY. An FK would (a) publish the
--     relationship in pg_constraint, so every ER diagram, ORM
--     introspection and "helpful" JOIN suggestion would surface it, and
--     (b) create a cascade path between the layers. Referential
--     integrity here is maintained by the verification service.
--   * UNIQUE on both columns: one subject <-> one app_user (invariant I4).
--   * FORCE ROW LEVEL SECURITY: the owner does not get a free pass.
-- --------------------------------------------------------------------
create table identity.app_user_link (
  subject_id      uuid primary key references identity.subject(id) on delete restrict,
  app_user_id     uuid not null,        -- NO FK. See comment above. Do not "fix" this.
  bound_at        timestamptz not null default now(),
  unbound_at      timestamptz,
  rebind_count    smallint not null default 0,
  constraint app_user_link_user_uniq unique (app_user_id)
);

comment on table identity.app_user_link is
  'SEALED. The subject <-> app_user binding. app_user_id intentionally has no FK to public.app_user: adding one would publish the relationship and create a cascade path between identity layers.';
comment on column identity.app_user_link.app_user_id is
  'Deliberately unconstrained uuid. Referential integrity is the verification service''s job. See docs/01-schema-notes.md.';

-- --------------------------------------------------------------------
-- 06.6 Legal requests and the access log
-- --------------------------------------------------------------------
create table identity.legal_request (
  id                   uuid primary key default util.uuid_v7(),
  case_ref             text not null unique,
  requesting_authority text not null,
  received_at          timestamptz not null,
  scope                text not null,
  legal_basis          text not null,
  approved_by          text,
  approved_at          timestamptz,
  rejected_at          timestamptz,
  executed_at          timestamptz,
  expires_at           timestamptz not null,
  notes                text,
  created_at           timestamptz not null default now(),
  constraint legal_request_decided_ck check (
    approved_at is null or rejected_at is null
  )
);

create table identity.access_log (
  id                uuid primary key default util.uuid_v7(),
  at                timestamptz not null default clock_timestamp(),
  db_role           text not null default current_user,
  actor_ref         text,                                    -- staff id / service instance
  purpose           identity.access_purpose not null,
  function_name     text not null,
  subject_id        uuid,
  app_user_id       uuid,
  legal_request_id  uuid references identity.legal_request(id),
  justification     text,
  session_ref       text
);
create index access_log_at_idx      on identity.access_log (at desc);
create index access_log_subject_idx on identity.access_log (subject_id, at desc);

-- Append-only. An auditor's log that can be edited is not a log.
create or replace function identity.tg_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'identity.% is append-only (attempted %)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end$$;

create trigger access_log_append_only
  before update or delete on identity.access_log
  for each row execute function identity.tg_append_only();

-- --------------------------------------------------------------------
-- 06.7 The seal
-- --------------------------------------------------------------------
create or replace function identity.is_unsealed() returns boolean
language sql stable parallel safe as $$
  select coalesce(current_setting('kiksu.identity_unsealed', true), 'off') = 'on';
$$;

-- Opens the seal for the REMAINDER OF THE CURRENT TRANSACTION ONLY
-- (set_config with is_local = true). Logs before it opens, so an
-- unlogged read is not reachable through this path.
create or replace function identity.unseal(
  p_purpose          identity.access_purpose,
  p_function_name    text,
  p_justification    text,
  p_subject_id       uuid default null,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns void
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
begin
  if p_justification is null or length(btrim(p_justification)) < 8 then
    raise exception 'identity.unseal requires a justification' using errcode = 'insufficient_privilege';
  end if;

  -- Legal reads require an approved, unexpired request on file.
  if p_purpose = 'legal_request' then
    if p_legal_request_id is null then
      raise exception 'legal_request purpose requires a legal_request_id' using errcode = 'insufficient_privilege';
    end if;
    perform 1 from identity.legal_request lr
     where lr.id = p_legal_request_id
       and lr.approved_at is not null
       and lr.rejected_at is null
       and lr.expires_at > now();
    if not found then
      raise exception 'legal request % is not approved or has expired', p_legal_request_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into identity.access_log (purpose, function_name, subject_id, legal_request_id, justification, actor_ref)
  values (p_purpose, p_function_name, p_subject_id, p_legal_request_id, p_justification, p_actor_ref);

  perform set_config('kiksu.identity_unsealed', 'on', true);
end$$;

revoke all on function identity.unseal(identity.access_purpose, text, text, uuid, uuid, text) from public;

-- The ONLY sanctioned way to walk from a subject to a pseudonym.
-- Two log lines are written: the intent (by unseal) and the resolved
-- value. Both are INSERTs — the log is append-only, so the resolved
-- value cannot be back-filled by UPDATE.
create or replace function identity.resolve_app_user(
  p_subject_id       uuid,
  p_purpose          identity.access_purpose,
  p_justification    text,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns uuid
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
declare v_app_user uuid;
begin
  perform identity.unseal(p_purpose, 'resolve_app_user', p_justification, p_subject_id, p_legal_request_id, p_actor_ref);
  select l.app_user_id into v_app_user
    from identity.app_user_link l
   where l.subject_id = p_subject_id and l.unbound_at is null;
  insert into identity.access_log (purpose, function_name, subject_id, app_user_id, legal_request_id, justification, actor_ref)
  values (p_purpose, 'resolve_app_user:result', p_subject_id, v_app_user, p_legal_request_id, p_justification, p_actor_ref);
  return v_app_user;
end$$;

revoke all on function identity.resolve_app_user(uuid, identity.access_purpose, text, uuid, text) from public;

-- ... and the reverse direction, which is what a safety escalation needs.
create or replace function identity.resolve_subject(
  p_app_user_id      uuid,
  p_purpose          identity.access_purpose,
  p_justification    text,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns uuid
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
declare v_subject uuid;
begin
  perform identity.unseal(p_purpose, 'resolve_subject', p_justification, null, p_legal_request_id, p_actor_ref);
  select l.subject_id into v_subject
    from identity.app_user_link l
   where l.app_user_id = p_app_user_id and l.unbound_at is null;
  return v_subject;
end$$;

revoke all on function identity.resolve_subject(uuid, identity.access_purpose, text, uuid, text) from public;

-- --------------------------------------------------------------------
-- 06.8 Regression detector for the auth anchor rule
-- Counts auth accounts whose email is NOT the synthetic domain. Must be
-- zero. Wire this into the invariant test suite and to alerting.
-- --------------------------------------------------------------------
create or replace view identity.auth_email_leak_check as
  select count(*) filter (where u.email is not null
                            and u.email not like '%@users.kiksu.app') as identifying_emails,
         count(*)                                                     as total_accounts
  from auth.users u;

comment on view identity.auth_email_leak_check is
  'identifying_emails must be 0. A non-zero value means a university email reached auth.users, which makes app_user -> auth.users a name leak.';


