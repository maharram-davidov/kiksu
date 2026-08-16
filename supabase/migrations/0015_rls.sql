-- =====================================================================
-- 18. ROW LEVEL SECURITY
-- =====================================================================
--
-- Trust model, stated once because every policy below depends on it:
--
--   * The mobile client NEVER holds a direct table grant. It talks to the
--     server layer (service_role — see docs/07-supabase-deviations.md #1),
--     which authorises in code. RLS is defence in depth for the PostgREST
--     path, not the primary control.
--
--   * The primary control for Layers 1, 3 and 4 is NOT RLS at all — it is
--     the schema-level REVOKE in section 02. identity.*, career.* and
--     internal.* are unreachable to anon/authenticated regardless of any
--     policy here. That is deliberate: a policy can be mis-written, a
--     missing schema grant cannot be worked around.
--
--   * Therefore NO POLICY IN THIS SECTION MAY REFERENCE internal.*,
--     identity.* OR career.*. A policy is evaluated with the caller's
--     privileges; referencing a sealed schema would either fail loudly or,
--     worse, force us to wrap it in SECURITY DEFINER and reintroduce the
--     exact linkage the architecture exists to prevent. In particular:
--     authorship of an anonymous post lives in internal.post_author, so
--     "my posts" is a SERVER-LAYER query, never an RLS predicate.
--
--   * public.post.author_app_user_id is NULL for every anonymous post and
--     is populated only for deliberately-identified posts (staff notice,
--     club announcement). Policies may use it ONLY for that identified
--     case. It is not authorship.
--
-- Performance: every helper call is wrapped in a subselect so Postgres
-- evaluates it once per statement as an InitPlan rather than once per row.
-- See the note at 07.2. This is the single biggest RLS cost lever.
-- ---------------------------------------------------------------------

-- 18.1 The server layer bypasses RLS deliberately.
--      service_role performs its own authorisation and needs to read rows
--      across users (feed assembly, moderation, notification fan-out).
--      Making it fight RLS would push us toward SECURITY DEFINER wrappers
--      everywhere, which is strictly worse. The sealed schemas remain
--      unreachable to it: service_role has no usage on identity or career
--      (revoked in migration 0000; never granted back anywhere below).
--
--      SUPABASE DEVIATION (docs/07-supabase-deviations.md #1 and #2): the
--      original line here was `alter role kiksu_app with bypassrls;`.
--      Granting BYPASSRLS to a role is one of the few privileges Postgres
--      restricts to an actual superuser, which the Supabase migration role
--      is not (see #2) — so this statement always fails on Supabase, no
--      matter which role it names. It is dropped entirely: service_role
--      already has BYPASSRLS natively as a platform-managed role, so there
--      is nothing left to grant.

-- 18.2 Board visibility — the predicate reused across the whole forum.
create or replace function public.can_read_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.board b
     where b.id = p_board_id
       and b.is_archived = false
       -- national boards (university_id is null) are visible to everyone;
       -- campus boards only to that campus.
       and (b.university_id is null
            or b.university_id = (select public.current_university_id()))
       -- enum is declared ascending, so this is a real tier gate.
       and (select public.current_tier()) >= b.min_tier_to_read
  );
$$;

comment on function public.can_read_board is
  'Board read gate: archived, campus scope, and minimum verification tier. Used by every forum policy.';

-- 18.3 Conversation participation — marketplace chat and DMs.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.conversation_participant cp
     where cp.conversation_id = p_conversation_id
       and cp.app_user_id = (select public.current_app_user_id())
  );
$$;

-- 18.4 Enrollment check — gates coursework and course materials.
create or replace function public.is_enrolled_in_section(p_section_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.enrollment e
     where e.section_id = p_section_id
       and e.app_user_id = (select public.current_app_user_id())
       and e.state = 'enrolled'
  );
$$;

-- ---------------------------------------------------------------------
-- 18.5 Enable RLS on every public table. Deny by default: a table with
--      RLS enabled and no matching policy returns zero rows.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select format('%I.%I', schemaname, tablename)
      from pg_tables
     where schemaname = 'public'
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- 18.6 Own-row tables. The user sees their rows and nobody else's.
-- ---------------------------------------------------------------------
create policy app_user_self on public.app_user
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy enrollment_self on public.enrollment
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy coursework_state_self on public.coursework_state
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy board_follow_self on public.board_follow
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy post_vote_self on public.post_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy comment_vote_self on public.comment_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy poll_vote_self on public.poll_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy post_save_self on public.post_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy review_helpful_self on public.review_helpful
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy listing_save_self on public.listing_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy vacancy_save_self on public.vacancy_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy notification_self on public.notification
  for select to authenticated
  using (recipient_id = (select public.current_app_user_id()));

create policy notification_preference_self on public.notification_preference
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy device_token_self on public.device_token
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy user_sanction_self on public.user_sanction
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy user_block_self on public.user_block
  for select to authenticated
  using (blocker_id = (select public.current_app_user_id()));

-- A reporter may see the reports they filed and nothing else. Reports are
-- otherwise invisible: being able to probe report state tells an abuser
-- whether they have been noticed.
create policy report_own on public.report
  for select to authenticated
  using (reporter_id = (select public.current_app_user_id()));

-- ---------------------------------------------------------------------
-- 18.7 Forum. Visibility follows the board, never the author.
-- ---------------------------------------------------------------------
create policy board_readable on public.board
  for select to authenticated
  using (
    is_archived = false
    and (university_id is null
         or university_id = (select public.current_university_id()))
    and (select public.current_tier()) >= min_tier_to_read
  );

create policy post_readable on public.post
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and (select public.can_read_board(board_id))
  );

create policy post_comment_readable on public.post_comment
  for select to authenticated
  using (
    exists (select 1 from public.post p
             where p.id = post_comment.post_id
               and p.moderation_state in ('visible', 'limited')
               and (select public.can_read_board(p.board_id)))
  );

create policy poll_readable on public.poll
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = poll.post_id
                    and (select public.can_read_board(p.board_id))));

create policy poll_option_readable on public.poll_option
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = poll_option.post_id
                    and (select public.can_read_board(p.board_id))));

create policy post_attachment_readable on public.post_attachment
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = post_attachment.post_id
                    and p.moderation_state in ('visible', 'limited')
                    and (select public.can_read_board(p.board_id))));

-- ---------------------------------------------------------------------
-- 18.8 Reviews. Campus-scoped. The contribution wall is NOT enforced here
--      — it is a server-layer rule, because "have you written a review
--      this semester" requires internal.review_author, which RLS may not
--      touch. RLS gates the campus boundary only.
-- ---------------------------------------------------------------------
create policy review_readable on public.review
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and deleted_at is null
    and university_id = (select public.current_university_id())
  );

create policy instructor_summary_readable on public.instructor_review_summary
  for select to authenticated using (true);

create policy course_summary_readable on public.course_review_summary
  for select to authenticated using (true);

create policy course_instructor_summary_readable on public.course_instructor_review_summary
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 18.9 Academic. Coursework and materials require enrollment.
-- ---------------------------------------------------------------------
create policy absence_self on public.absence
  for select to authenticated
  using (exists (select 1 from public.enrollment e
                  where e.id = absence.enrollment_id
                    and e.app_user_id = (select public.current_app_user_id())));

create policy coursework_enrolled on public.coursework
  for select to authenticated
  using ((select public.is_enrolled_in_section(section_id)));

create policy course_material_enrolled on public.course_material
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and deleted_at is null
    and (section_id is null or (select public.is_enrolled_in_section(section_id)))
  );

-- Cohort sizes are counts with no identifiers; they back the k-anonymity
-- floor and are safe to read.
create policy cohort_size_readable on public.cohort_size
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 18.10 Marketplace.
-- ---------------------------------------------------------------------
create policy listing_readable on public.listing
  for select to authenticated
  using (
    status in ('active', 'reserved', 'sold')
    and moderation_state in ('visible', 'limited')
    and deleted_at is null
    and university_id = (select public.current_university_id())
  );

create policy listing_image_readable on public.listing_image
  for select to authenticated
  using (exists (select 1 from public.listing l
                  where l.id = listing_image.listing_id
                    and l.university_id = (select public.current_university_id())));

-- A deal is visible to its two parties only.
create policy deal_participant on public.deal
  for select to authenticated
  using (seller_id = (select public.current_app_user_id())
         or buyer_id = (select public.current_app_user_id()));

-- Trade ratings are public reputation — they are what makes a pseudonymous
-- seller trustworthy, and the design renders them on the seller card.
create policy trade_rating_readable on public.trade_rating
  for select to authenticated using (true);

create policy conversation_participant_only on public.conversation
  for select to authenticated
  using ((select public.is_conversation_participant(id)));

create policy conversation_participant_self on public.conversation_participant
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy chat_message_participant on public.chat_message
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_conversation_participant(conversation_id))
  );

-- ---------------------------------------------------------------------
-- 18.11 Careers (public side only — career.* is a separate sealed schema).
-- ---------------------------------------------------------------------
create policy employer_readable on public.employer
  for select to authenticated
  using (is_active = true);

create policy employer_recruiter_self on public.employer_recruiter
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy vacancy_readable on public.vacancy
  for select to authenticated
  using (
    status = 'active'
    and (target_university_ids is null
         or cardinality(target_university_ids) = 0
         or (select public.current_university_id()) = any (target_university_ids))
  );

-- ---------------------------------------------------------------------
-- 18.12 Events and clubs.
-- ---------------------------------------------------------------------
create policy club_readable on public.club
  for select to authenticated
  using (university_id is null
         or university_id = (select public.current_university_id()));

create policy club_member_self on public.club_member
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy campus_event_readable on public.campus_event
  for select to authenticated
  using (university_id is null
         or university_id = (select public.current_university_id()));

create policy event_rsvp_self on public.event_rsvp
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));


