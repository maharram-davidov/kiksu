-- =====================================================================
-- 19. GRANTS
-- =====================================================================
-- Section 02 revoked everything. This hands back the minimum.
--
-- Note what authenticated does NOT get: no INSERT, UPDATE or DELETE on
-- anything. Every write in Kiksu goes through the server layer, because
-- writes are where alias allocation, karma, counters and the contribution
-- wall are enforced, and none of those are expressible as a CHECK.
-- ---------------------------------------------------------------------

-- SUPABASE DEVIATION (see docs/07-supabase-deviations.md #1): every grant
-- below that the original schema made to `kiksu_app` is made to Supabase's
-- `service_role` instead — same privileges, same tables, different name for
-- the same "trusted server layer" role. See migration 0000 for why.

-- Reference data is world-readable to signed-in users.
grant select on all tables in schema ref to authenticated, service_role;
alter default privileges in schema ref
  grant select on tables to authenticated, service_role;

-- Public schema: SELECT only, filtered by section 18.
grant select on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select on tables to authenticated;

-- The server layer gets full DML on public and internal, nothing on the
-- sealed schemas.
grant select, insert, update, delete on all tables in schema public   to service_role;
grant select, insert, update, delete on all tables in schema internal to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema internal
  grant select, insert, update, delete on tables to service_role;

-- Verification service: the only role that may touch Layer 1.
grant select, insert, update on all tables in schema identity to kiksu_identity_svc;

-- Career service: the only role that may touch Layer 4.
grant select, insert, update on all tables in schema career to kiksu_career_svc;

-- Moderation console.
grant select, insert, update on all tables in schema moderation to kiksu_moderator;
grant select on all tables in schema public to kiksu_moderator;

-- Recompute jobs.
grant select on all tables in schema public to kiksu_analytics;
grant update on public.app_user, public.board, public.post to kiksu_analytics;

-- Utility functions.
grant execute on all functions in schema util to authenticated, service_role;
grant execute on function
  public.current_app_user_id(), public.current_university_id(), public.current_tier(),
  public.can_read_board(uuid), public.is_conversation_participant(uuid),
  public.is_enrolled_in_section(uuid)
  to authenticated, service_role;

-- PostgREST must never expose the sealed schemas. Enforced in config too;
-- this is the belt to that braces.
comment on schema identity is 'SEALED. Exclude from PostgREST db-schemas.';
comment on schema career   is 'SEALED. Exclude from PostgREST db-schemas.';
comment on schema internal is 'SEALED. Exclude from PostgREST db-schemas.';

-- end of schema


-- =====================================================================
-- 20. PUBLIC PROFILE PROJECTION
-- =====================================================================
--
-- Closes the karma-delta oracle (02-identity-spec.md §1, S1).
--
-- THE ATTACK: the profile screen shows an exact karma integer. If any
-- surface lets you read another user's karma on demand, you poll a target
-- before and after a post appears in a board, and a +1 delta links that
-- stable pseudonym to that specific anonymous post with certainty. No
-- exploit required — just documented API surface and a clock.
--
-- THE FIX is to delete the oracle rather than guard it:
--
--   1. Exact karma is OWN-ROW ONLY. It appears in public.app_user_card,
--      which is security_invoker and therefore RLS-confined to your row.
--      It is not in the cross-user projection at all.
--   2. Others see a COARSE, DELAYED contributor level. Coarse so a single
--      post cannot move it; delayed so the moment it does move carries no
--      timing information.
--   3. Nothing else about another user is readable: no created_at (account
--      age correlates with cohort), no card_review_state (an in-flight card
--      review is a real-world event with a timestamp), no counts.
-- ---------------------------------------------------------------------

-- 20.1 Contributor level — the fuzzy replacement for exact karma.
--      Buckets are deliberately wide and super-linear: at level 3 a user
--      needs 750 more karma to advance, so no realistic amount of posting
--      moves the badge within an observation window.
create or replace function public.contributor_level_for(p_karma integer)
returns smallint
language sql immutable parallel safe as $$
  select case
           when p_karma is null or p_karma <   50 then 0::smallint  -- Yeni
           when p_karma <  250 then 1::smallint                     -- Katılımçı
           when p_karma < 1000 then 2::smallint                     -- Fəal
           when p_karma < 5000 then 3::smallint                     -- Təcrübəli
           else                     4::smallint                     -- Ağsaqqal
         end;
$$;

comment on function public.contributor_level_for is
  'Karma -> coarse badge. Buckets are wide on purpose: a single post must never be able to move a level.';

-- Materialised, NOT computed at read time. Computing it live would restore
-- the oracle at one bucket boundary: an observer watching a user near 250
-- karma would still see the badge flip on a known post.
alter table public.app_user
  add column if not exists contributor_level    smallint not null default 0,
  add column if not exists contributor_level_at timestamptz;

comment on column public.app_user.contributor_level is
  'Coarse public standing. Refreshed on a DELAYED schedule by public.refresh_contributor_levels(); never updated in the same transaction as a karma change.';

-- 20.2 The delayed refresh. Scheduled daily, off-peak, in migration 0016.
--      The delay is the security control, so do not "helpfully" call this
--      from a karma trigger.
create or replace function public.refresh_contributor_levels()
returns integer
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  update public.app_user au
     set contributor_level    = public.contributor_level_for(au.karma),
         contributor_level_at = now()
   where au.contributor_level is distinct from public.contributor_level_for(au.karma)
     -- Never let a level change land within 24h of the karma that caused
     -- it; that window is what makes the badge uncorrelatable with a post.
     and au.updated_at < now() - interval '24 hours';
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

comment on function public.refresh_contributor_levels is
  'DELAYED on purpose. Runs daily off-peak. Calling this from a karma trigger would reintroduce the karma-delta oracle.';

-- 20.3 public_profiles — the ONLY cross-user read of another person.
--
-- SECURITY DEFINER semantics (security_invoker off) are deliberate: the
-- view must read across users, which app_user's own-row RLS forbids. Safety
-- comes from the column list, not from RLS. Adding a column here is a
-- security change and must be reviewed as one.
create or replace view public.public_profiles
  with (security_invoker = off) as
  select au.id,
         au.handle,
         au.avatar_id,
         -- Campus badge only when the user opted in AND the cohort is large
         -- enough to hide in. display_cohort_size is maintained by the
         -- k-anonymity projection job (02-identity-spec.md §5).
         case when au.privacy_show_uni_badge
               and coalesce(au.display_cohort_size, 0) >= 20
              then au.university_id
         end                                        as university_id,
         -- Coarse status. NOT card_review_state: 'pending' would announce
         -- that a specific person submitted a card at a knowable time.
         case when au.verification_tier = 'card_verified'  then 'card'
              when au.verification_tier = 'email_verified' then 'email'
              else 'none'
         end                                        as verification_status,
         au.contributor_level
    from public.app_user au
   where au.status in ('active', 'muted');

comment on view public.public_profiles is
  'The ONLY way to read another user. handle, avatar, opt-in campus badge, coarse verification, coarse delayed level. No karma, no created_at, no counts, no card state. Adding a column is a security change.';

-- Marketplace and DM need to resolve a handle; they get this and nothing else.
grant select on public.public_profiles to authenticated, service_role;

-- Belt and braces behind the RLS in section 18: even if a policy on
-- app_user were later widened by mistake, authenticated holds no
-- column privileges on the sensitive columns.
revoke select on public.app_user from authenticated;
grant select (id, handle, handle_number, avatar_id, verification_tier,
              university_id, contributor_level)
  on public.app_user to authenticated;

-- end of section 20
