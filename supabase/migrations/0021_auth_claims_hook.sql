-- Access token claims and revocation.
--
-- The API's AuthGuard already verifies a Supabase access token completely:
-- signature against the project JWKS, the user_metadata trap, the synthetic
-- email leak alarm, the app_metadata allowlist, and the epoch comparison.
-- Nothing has ever MINTED such a token. This section is the other half.
--
-- Three objects, in dependency order:
--
--   internal.auth_epoch    the revocation counter (identity spec §7.3)
--   internal.token_claims  the minimal claims projection (§7.1)
--   auth_hooks.custom_access_token_hook   what Supabase Auth calls at mint
--
-- The load-bearing property is stated in §7.1: "The hook must not be able to
-- read the sealed store — if it can, every token mint is a sealed-store read."
-- Token minting is the single highest-frequency operation in the product, so
-- a hook with a grant on `identity` would turn the sealed store's read-volume
-- budget (tens of reads per day, §7.4) into millions, destroying the cheapest
-- detector this design has. Hence a dedicated owner role whose ONLY reachable
-- object is the six-column projection, and invariant 11 to keep it that way.

-- ---------------------------------------------------------------------
-- 24.1 The hook's owner role and its schema
-- ---------------------------------------------------------------------
-- A dedicated NOLOGIN role, following the pattern of kiksu_identity_svc and
-- kiksu_career_svc in section 02: the privilege boundary is a role, not a
-- convention about which code calls what.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kiksu_auth_hook_owner') then
    create role kiksu_auth_hook_owner nologin; -- token minting only
  end if;
  -- Supabase's own GoTrue role. Present on the platform; absent on the
  -- throwaway Postgres the verification scripts stand up, where the hook is
  -- exercised by calling it directly rather than by GoTrue.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end$$;

-- Same membership requirement as deviation #2 in docs/07-supabase-deviations.md:
-- `alter ... owner to` needs the current role to be a MEMBER of the target
-- role, and CREATEROLE alone does not confer that. Plain membership, never
-- `with admin option` — Postgres 16+ rejects granting admin back to your own
-- grantor.
grant kiksu_auth_hook_owner to postgres;

create schema if not exists auth_hooks;
alter schema auth_hooks owner to kiksu_auth_hook_owner;

-- Nobody by default, exactly as section 02 does for the other custom schemas.
revoke all on schema auth_hooks from public;
revoke usage on schema auth_hooks from anon, authenticated, service_role;

-- The whole point of the role. Spelled out rather than left to the fact that
-- section 02 already revoked these from public: a future migration that
-- widens `identity` grants should have to delete these lines to do it.
revoke usage on schema identity from kiksu_auth_hook_owner;
revoke usage on schema career   from kiksu_auth_hook_owner;
grant  usage on schema internal to kiksu_auth_hook_owner;

-- ---------------------------------------------------------------------
-- 24.2 internal.auth_epoch — the revocation primitive
-- ---------------------------------------------------------------------
-- Identity spec §7.4: revocation on the hot path is ONE INTEGER COMPARISON,
-- not an identity fetch. `token.epoch < current_epoch(app_user_id)` is the
-- entire check, so a ban takes effect on the next request rather than at the
-- next token expiry.
--
-- Deliberately a table rather than a column on public.app_user, for two
-- reasons. §7.3 lists eight distinct events that bump the counter (tier
-- grant, tier expiry, graduation, suspension, ban, unban, role change, forced
-- logout) and which one fired is worth keeping — "this session was killed,
-- and why" is the first question asked when a student reports being logged
-- out. And app_user carries FORCE ROW LEVEL SECURITY with an own-row policy;
-- hanging the token-mint path off it would mean the hook's reachable surface
-- includes a table whose policies exist for a different purpose entirely.
create table if not exists internal.auth_epoch (
  app_user_id  uuid primary key references public.app_user(id) on delete cascade,
  epoch        integer not null default 1,
  bumped_at    timestamptz not null default now(),
  -- The eight triggers from §7.3, plus the initial row. Constrained rather
  -- than free text so that a typo'd reason is a failed write and not a hole
  -- in the audit trail.
  reason       text not null default 'provisioned'
                 check (reason in ('provisioned', 'tier_grant', 'tier_expiry',
                                   'graduation', 'suspension', 'ban', 'unban',
                                   'role_change', 'forced_logout'))
);

comment on table internal.auth_epoch is
  'Revocation counter, one row per app_user. A token whose epoch is below this value is stale and rejected (identity spec §7.4). Lives in internal, not public: the value is a side channel — a client that could watch its own epoch climb would learn when moderation acted on it.';

-- Every existing user needs a row, or their first token carries the
-- coalesced default and the first bump has nothing to increment.
insert into internal.auth_epoch (app_user_id, epoch, reason)
select id, 1, 'provisioned' from public.app_user
on conflict (app_user_id) do nothing;

-- One implementation of the bump, so the API and any future SQL path cannot
-- drift. Returns the new value: callers that need to mint a token immediately
-- afterwards must not race a second read to find out what they just wrote.
create or replace function internal.bump_auth_epoch(p_app_user_id uuid, p_reason text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into internal.auth_epoch (app_user_id, epoch, bumped_at, reason)
  values (p_app_user_id, 2, now(), p_reason)
  on conflict (app_user_id) do update
    set epoch     = internal.auth_epoch.epoch + 1,
        bumped_at = now(),
        reason    = excluded.reason
  returning epoch;
$$;

comment on function internal.bump_auth_epoch(uuid, text) is
  'Increments the revocation counter and returns the new value. Seeds at 2 when no row exists, so the result always exceeds the 1 that internal.token_claims coalesces to — a missing row must never make a bump a no-op.';

revoke execute on function internal.bump_auth_epoch(uuid, text) from public, anon, authenticated;
grant  execute on function internal.bump_auth_epoch(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 24.3 internal.token_claims — the minimal claims projection
-- ---------------------------------------------------------------------
-- Identity spec §7.1 lists the complete set of claims and closes with "That
-- is the complete list. Anything not on it is not in the token." This view IS
-- that list, and invariant 11 fails if it ever grows a column.
--
-- What is NOT here is the point: no handle (it changes, so a stale token
-- would be a rename oracle, and it would land in every access log that
-- captures a bearer token), no faculty or entry year (exactly the attributes
-- the k-anonymity floor exists to generalise), no karma, no email. §7.2.
--
-- security_invoker is OFF (the default), so the view runs with its owner's
-- privileges and can read across users. That is required — the hook resolves
-- an arbitrary auth uid at mint time — and it is safe for the same reason
-- public.public_profiles is safe: the column allowlist is the control, not
-- RLS. The hook role holds SELECT on this view and on nothing else.
create or replace view internal.token_claims as
  select
    au.auth_user_id,
    au.id as app_user_id,

    -- Tier vocabulary translation. public.verification_tier has three values;
    -- the token allowlist in apps/api/src/common/auth/claims.ts has five.
    -- Nothing mapped between them before this view existed, which is why
    -- buildDevContext emitted the token vocabulary while the onboarding
    -- service returned the database one.
    --
    -- 'graduate' and 'expired' are UNREACHABLE and deliberately so: there is
    -- no graduation transition and no credential-expiry job in this schema,
    -- so no row can produce them. They stay in the allowlist because §7.3
    -- names them as epoch-bump triggers and the API should not have to change
    -- when the job that produces them is written. Do not invent a mapping
    -- for them here from status or from suspended_until — suspension is not
    -- expiry, and conflating the two would silently downgrade every
    -- suspended student's badge.
    case au.verification_tier
      when 'unverified'     then 'provisional'
      when 'email_verified' then 'email'
      when 'card_verified'  then 'card'
    end as tier,

    -- Role vocabulary translation. moderation.staff.role has four values
    -- against the token's three, and staff is keyed by auth_user_id rather
    -- than app_user_id.
    --
    -- 'legal' maps to 'student', NOT to 'moderator'. The token's role gates
    -- moderation writes in the mobile API; legal work happens through the
    -- sealed-store unseal path, which this token cannot reach and which has
    -- its own authorisation. Granting a legal staffer moderation capability
    -- on the strength of their job title would be a privilege they never
    -- asked for and cannot be audited through the moderation queue.
    --
    -- Per-board moderator scope is NOT here: §7.1 requires it be looked up
    -- server-side because board assignments change more often than tokens are
    -- minted.
    coalesce(
      (select case s.role
                when 'admin'             then 'admin'
                when 'senior_moderator'  then 'moderator'
                when 'moderator'         then 'moderator'
                when 'legal'             then 'student'
              end
         from moderation.staff s
        where s.auth_user_id = au.auth_user_id and s.is_active),
      'student'
    ) as role,

    au.university_id as univ_id,

    -- Coalesced so that a missing epoch row degrades to "never revoked"
    -- rather than to a null claim, which would fail the allowlist parse and
    -- lock the student out. bump_auth_epoch seeds at 2 precisely so that this
    -- fallback can never outrank a real bump.
    coalesce(ae.epoch, 1) as epoch

  from public.app_user au
  left join internal.auth_epoch ae on ae.app_user_id = au.id
  -- An erased or deactivated account gets no claims, so its tokens fail the
  -- allowlist parse and the guard rejects them. Suspended and shadowbanned
  -- accounts DO get claims: a suspended student has to be able to sign in to
  -- read why, and a shadowbanned one must not be able to detect the sanction
  -- by being unable to authenticate at all.
  where au.status not in ('deactivated', 'erased')
    -- A row with no university cannot produce a usable claim set: univ_id is
    -- required by the allowlist, so a null there fails the parse and the
    -- guard answers token_invalid — whose documented client action (§2.5) is
    -- "sign out". A student in that state would be signed out on every
    -- attempt, in a loop, told their token was malformed rather than that
    -- they had not finished onboarding.
    --
    -- app_user_tier_needs_uni permits exactly this row: 'unverified' with a
    -- null university is the table's own default state. No current code path
    -- creates one — onboarding writes 'email_verified' and card approval
    -- writes 'card_verified' — but the schema allows it, and the failure mode
    -- is bad enough that it must be closed here rather than left to the fact
    -- that nothing happens to write it today.
    --
    -- Excluding the row is the correct outcome, not a workaround: a caller
    -- with no campus has nothing to scope reads by, so they belong on the
    -- @Public() onboarding routes exactly like a caller with no app_user.
    and au.university_id is not null;

comment on view internal.token_claims is
  'The complete set of claims that may enter an access token (identity spec §7.1), and the only object the token-mint hook can read. Six columns, asserted by invariant 11. Adding one is a security change to every token the product has ever issued.';

revoke all on internal.token_claims from public, anon, authenticated, service_role;
grant select on internal.token_claims to kiksu_auth_hook_owner;

-- ---------------------------------------------------------------------
-- 24.4 The access token hook
-- ---------------------------------------------------------------------
-- Supabase Auth calls this on every access token mint, passing
-- {"user_id": uuid, "claims": {...}, "authentication_method": "..."} and
-- taking back the event with `claims` replaced. Registering it is a project
-- setting, not SQL — see docs/04-infrastructure.md.
--
-- SECURITY DEFINER so it runs as kiksu_auth_hook_owner rather than as
-- supabase_auth_admin: GoTrue's own role is broadly privileged inside `auth`,
-- and a hook that inherited it would be a far larger blast radius than the
-- one object this function actually needs.
--
-- `set search_path = ''` for the reason the advisor flags 24 other functions
-- in this schema: without it, a schema earlier on the path can shadow
-- `internal.token_claims` and feed this function attacker-chosen claims.
-- Every reference below is therefore fully qualified.
create or replace function auth_hooks.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_app_md  jsonb := coalesce(event -> 'claims' -> 'app_metadata', '{}'::jsonb);
  v_sid     text  := v_claims ->> 'session_id';
  v_row     record;
begin
  select tc.app_user_id, tc.tier, tc.role, tc.univ_id, tc.epoch
    into v_row
    from internal.token_claims tc
   where tc.auth_user_id = (event ->> 'user_id')::uuid;

  -- Two ways to reach here without a claim set, and both must fail CLOSED.
  --
  -- No projection row: the caller has signed in anonymously but has not
  -- finished onboarding, or their account is erased or deactivated. This is
  -- the NORMAL case for a new student and is not an error — a pre-onboarding
  -- caller only ever reaches @Public() routes, which skip the guard entirely.
  --
  -- No session_id: every real access token carries one, so its absence means
  -- something is wrong with the mint. Emitting the block without `sid` would
  -- fail the allowlist parse anyway; emitting a fabricated one would corrupt
  -- the only session identifier moderation has for targeted revocation.
  --
  -- In both cases the six keys are STRIPPED rather than merely not written.
  -- app_metadata is server-writable only, but that makes the admin API the
  -- sole way a stale claim could persist there, and this hook — not whatever
  -- last touched raw_app_meta_data — is the authority on these six values.
  if not found or v_sid is null then
    return jsonb_set(
      event, '{claims,app_metadata}',
      v_app_md - 'app_user_id' - 'tier' - 'role' - 'univ_id' - 'epoch' - 'sid'
    );
  end if;

  -- Merged into app_metadata rather than written at the top level, because
  -- app_metadata is the half of the token a client cannot write. The guard
  -- reads these claims from nowhere else; see the user_metadata trap in
  -- apps/api/src/common/auth/auth.guard.ts.
  return jsonb_set(
    event, '{claims,app_metadata}',
    v_app_md || jsonb_build_object(
      'app_user_id', v_row.app_user_id,
      'tier',        v_row.tier,
      'role',        v_row.role,
      'univ_id',     v_row.univ_id,
      'epoch',       v_row.epoch,
      -- Copied from the registered claim rather than generated, so the value
      -- in app_metadata is the same session GoTrue already knows about.
      'sid',         v_sid
    )
  );
end;
$$;

alter function auth_hooks.custom_access_token_hook(jsonb) owner to kiksu_auth_hook_owner;

comment on function auth_hooks.custom_access_token_hook(jsonb) is
  'Stamps the six trusted claims of identity spec §7.1 into app_metadata at token mint. Fails closed: a caller with no projection row gets a token with those keys stripped, which the API rejects as token_invalid.';

-- GoTrue calls it; nobody else may. A client with EXECUTE could enumerate
-- app_user_id and univ_id for any auth uid it could guess.
revoke execute on function auth_hooks.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant  usage   on schema   auth_hooks to supabase_auth_admin;
grant  execute on function auth_hooks.custom_access_token_hook(jsonb) to supabase_auth_admin;
