-- =====================================================================
-- 04. ENUM TYPES
-- Closed structural sets only. Anything that product/ops will want to
-- extend without a migration is a lookup table in `ref` instead.
-- =====================================================================

create type public.locale_code            as enum ('az', 'ru', 'en');
create type public.verification_tier      as enum ('unverified', 'email_verified', 'card_verified');
create type public.verification_method    as enum ('university_email', 'student_card', 'invite_code', 'manual_staff');
create type public.app_user_status        as enum ('pending', 'active', 'muted', 'suspended', 'shadowbanned', 'deactivated', 'erased');
create type public.term_season            as enum ('payiz', 'yaz', 'yay');           -- autumn / spring / summer
create type public.meeting_kind           as enum ('lecture', 'seminar', 'lab', 'exam', 'consultation');
create type public.week_parity            as enum ('every', 'odd', 'even');
create type public.enrollment_state       as enum ('enrolled', 'dropped', 'completed', 'failed');
create type public.absence_kind           as enum ('absent', 'late', 'excused');
create type public.absence_source         as enum ('self_reported', 'instructor', 'import');
create type public.coursework_kind        as enum ('homework', 'lab', 'project', 'quiz', 'midterm', 'final', 'presentation', 'other');
create type public.coursework_origin      as enum ('official', 'crowdsourced', 'personal');
create type public.board_scope            as enum ('national', 'university', 'faculty', 'course', 'club');
create type public.post_kind              as enum ('text', 'image', 'link', 'poll');
create type public.author_display_mode    as enum ('alias', 'handle', 'staff');
create type public.moderation_state       as enum ('visible', 'pending_review', 'limited', 'removed');
create type public.listing_condition      as enum ('new', 'like_new', 'good', 'fair', 'poor');
create type public.listing_status         as enum ('draft', 'active', 'reserved', 'sold', 'expired', 'removed');
create type public.deal_state             as enum ('inquiry', 'agreed', 'completed', 'cancelled', 'disputed');
create type public.conversation_kind      as enum ('listing', 'direct');
create type public.chat_message_kind      as enum ('text', 'image', 'offer', 'system');
create type public.vacancy_kind           as enum ('internship', 'part_time', 'full_time', 'volunteer', 'thesis', 'scholarship');
create type public.work_mode              as enum ('onsite', 'hybrid', 'remote');
create type public.vacancy_status         as enum ('draft', 'active', 'paused', 'closed', 'expired');
create type public.event_kind             as enum ('career', 'academic', 'club', 'social', 'sport', 'other');
create type public.rsvp_state             as enum ('going', 'interested', 'cancelled');
create type public.club_member_role       as enum ('owner', 'admin', 'member');
create type public.report_target_type     as enum ('post', 'comment', 'review', 'listing', 'chat_message', 'app_user', 'event', 'club');
create type public.alias_state            as enum ('reserved', 'active');
create type public.accent_color           as enum ('turquoise', 'bronze', 'pomegranate', 'indigo', 'ink', 'moss', 'plum');

create type identity.verification_state   as enum ('none', 'pending', 'in_review', 'verified', 'rejected', 'expired', 'revoked');
create type identity.credential_kind      as enum ('university_email', 'student_number', 'card_image_hash', 'invite_code', 'national_id');
create type identity.access_purpose       as enum ('verification', 'legal_request', 'safety_escalation', 'user_data_request', 'cohort_recount', 'incident_response');

create type career.application_state      as enum ('draft', 'submitted', 'viewed', 'shortlisted', 'rejected', 'withdrawn', 'hired');
create type career.document_kind          as enum ('cv', 'transcript', 'certificate', 'portfolio', 'cover_letter');

create type moderation.mod_case_state         as enum ('open', 'triage', 'actioned', 'dismissed', 'escalated');
create type moderation.action_kind        as enum ('no_action', 'remove_content', 'restore_content', 'warn', 'mute', 'suspend', 'ban', 'shadowban', 'unban', 'escalate_legal');
create type moderation.staff_role         as enum ('moderator', 'senior_moderator', 'admin', 'legal');


-- Postgres declares enum_out() STABLE, so `some_enum::text` is STABLE too
-- and Postgres refuses it inside a stored generated column or an index
-- expression. Every generated column that needs the locale as text must go
-- through this CASE-based helper, which is genuinely immutable.
create or replace function util.locale_text(l public.locale_code) returns text
language sql immutable parallel safe strict as $$
  select case l when 'az' then 'az' when 'ru' then 'ru' when 'en' then 'en' end;
$$;

comment on function util.locale_text(public.locale_code) is
  'Immutable enum->text. Never write lang::text in a generated column or index; enum_out is STABLE.';

