-- =====================================================================
-- 17. COUNTER MAINTENANCE
--
-- Rule of thumb applied throughout:
--   TRIGGER      when the counter is an exact integer sum/count, the
--                write rate is human-scale, and staleness is visible to
--                the user (votes, comments, followers, absences).
--   RECOMPUTE    when the statistic is not incrementally derivable
--                (medians, percentiles, "top N"), needs a rolling
--                window, or is written at machine rate (views).
--   LEDGER+FOLD  when a trigger would serialise many writers on one hot
--                row (karma on a popular author).
--
-- The full table is in docs/01-schema-notes.md.
-- =====================================================================

-- --------------------------------------------------------------------
-- 17.1 Post votes -> score, hot_rank, karma ledger
-- --------------------------------------------------------------------
create table internal.karma_ledger (
  id            bigint generated always as identity primary key,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  delta         integer not null,
  reason        text not null,
  source_type   text,
  source_id     uuid,
  created_at    timestamptz not null default now(),
  folded_at     timestamptz
);
create index karma_ledger_unfolded_idx on internal.karma_ledger (app_user_id)
  where folded_at is null;

comment on table internal.karma_ledger is
  'Append-only karma deltas. A trigger that updated app_user.karma directly would make every voter on a popular post contend for one row; folding runs on a schedule instead.';

create or replace function public.tg_post_vote_counts() returns trigger
language plpgsql as $$
declare
  v_up integer := 0;
  v_down integer := 0;
  v_delta integer := 0;
  v_post uuid;
  v_score integer;
  v_created timestamptz;
  v_author uuid;
begin
  v_post := coalesce(new.post_id, old.post_id);

  if tg_op = 'INSERT' then
    v_up   := case when new.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end;
    v_delta := new.value;
  elsif tg_op = 'DELETE' then
    v_up   := case when old.value = 1 then -1 else 0 end;
    v_down := case when old.value = -1 then -1 else 0 end;
    v_delta := -old.value;
  else
    v_up   := case when new.value = 1 then 1 else 0 end - case when old.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end - case when old.value = -1 then 1 else 0 end;
    v_delta := new.value - old.value;
  end if;

  update public.post
     set upvote_count   = upvote_count + v_up,
         downvote_count = downvote_count + v_down,
         score          = score + v_delta,
         hot_rank       = util.hot_rank(score + v_delta, created_at)
   where id = v_post
   returning score, created_at into v_score, v_created;

  -- Karma follows the author, so it needs the (internal) authorship map.
  select pa.app_user_id into v_author from internal.post_author pa where pa.post_id = v_post;
  if v_author is not null and v_delta <> 0 then
    insert into internal.karma_ledger (app_user_id, delta, reason, source_type, source_id)
    values (v_author, v_delta, 'post_vote', 'post', v_post);
  end if;

  return null;
end$$;

create trigger post_vote_counts
  after insert or update or delete on public.post_vote
  for each row execute function public.tg_post_vote_counts();

create or replace function public.tg_comment_vote_counts() returns trigger
language plpgsql as $$
declare v_delta integer; v_up integer; v_down integer; v_comment uuid; v_author uuid;
begin
  v_comment := coalesce(new.comment_id, old.comment_id);
  if tg_op = 'INSERT' then
    v_up := case when new.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end;
    v_delta := new.value;
  elsif tg_op = 'DELETE' then
    v_up := case when old.value = 1 then -1 else 0 end;
    v_down := case when old.value = -1 then -1 else 0 end;
    v_delta := -old.value;
  else
    v_up := case when new.value = 1 then 1 else 0 end - case when old.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end - case when old.value = -1 then 1 else 0 end;
    v_delta := new.value - old.value;
  end if;

  update public.post_comment
     set upvote_count = upvote_count + v_up,
         downvote_count = downvote_count + v_down,
         score = score + v_delta
   where id = v_comment;

  select ca.app_user_id into v_author from internal.comment_author ca where ca.comment_id = v_comment;
  if v_author is not null and v_delta <> 0 then
    insert into internal.karma_ledger (app_user_id, delta, reason, source_type, source_id)
    values (v_author, v_delta, 'comment_vote', 'comment', v_comment);
  end if;
  return null;
end$$;

create trigger comment_vote_counts
  after insert or update or delete on public.comment_vote
  for each row execute function public.tg_comment_vote_counts();

-- Fold the ledger into app_user.karma. Run every minute or so.
create or replace function public.fold_karma_ledger(p_limit integer default 50000)
returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with batch as (
    select id, app_user_id, delta
      from internal.karma_ledger
     where folded_at is null
     order by id
     limit p_limit
     for update skip locked
  ),
  agg as (
    select app_user_id, sum(delta) as delta from batch group by app_user_id
  ),
  upd as (
    update public.app_user au
       set karma = au.karma + agg.delta
      from agg where au.id = agg.app_user_id
    returning 1
  )
  update internal.karma_ledger kl
     set folded_at = now()
    from batch where kl.id = batch.id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

-- --------------------------------------------------------------------
-- 17.2 Comments -> post.comment_count, board.last_post_at, reply_count
-- --------------------------------------------------------------------
create or replace function public.tg_comment_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.post
       set comment_count = comment_count + 1,
           last_comment_at = greatest(coalesce(last_comment_at, new.created_at), new.created_at)
     where id = new.post_id;
    if new.parent_id is not null then
      update public.post_comment set reply_count = reply_count + 1 where id = new.parent_id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.post set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    if old.parent_id is not null then
      update public.post_comment set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
    end if;
  elsif tg_op = 'UPDATE' and (old.deleted_at is null) <> (new.deleted_at is null) then
    -- Soft delete/restore also moves the visible count.
    update public.post
       set comment_count = greatest(0, comment_count + case when new.deleted_at is null then 1 else -1 end)
     where id = new.post_id;
  end if;
  return null;
end$$;

create trigger comment_counts
  after insert or delete or update of deleted_at on public.post_comment
  for each row execute function public.tg_comment_counts();

-- --------------------------------------------------------------------
-- 17.3 Generic single-column counter helper
-- Used for the many "count children on a parent" caches. Keeping one
-- function avoids eight near-identical trigger bodies.
-- --------------------------------------------------------------------
create or replace function public.tg_bump_counter() returns trigger
language plpgsql as $$
declare
  v_parent_table text := tg_argv[0];   -- e.g. 'public.board'
  v_parent_col   text := tg_argv[1];   -- e.g. 'board_id'
  v_counter_col  text := tg_argv[2];   -- e.g. 'follower_count'
  v_id uuid;
  v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_delta := 1;
    execute format('select ($1).%I', v_parent_col) into v_id using new;
  else
    v_delta := -1;
    execute format('select ($1).%I', v_parent_col) into v_id using old;
  end if;
  execute format('update %s set %I = greatest(0, %I + $1) where id = $2',
                 v_parent_table, v_counter_col, v_counter_col)
    using v_delta, v_id;
  return null;
end$$;

create trigger board_follow_counter
  after insert or delete on public.board_follow
  for each row execute function public.tg_bump_counter('public.board', 'board_id', 'follower_count');

create trigger post_save_counter
  after insert or delete on public.post_save
  for each row execute function public.tg_bump_counter('public.post', 'post_id', 'save_count');

create trigger listing_save_counter
  after insert or delete on public.listing_save
  for each row execute function public.tg_bump_counter('public.listing', 'listing_id', 'save_count');

create trigger club_member_counter
  after insert or delete on public.club_member
  for each row execute function public.tg_bump_counter('public.club', 'club_id', 'member_count');

create trigger post_attachment_counter
  after insert or delete on public.post_attachment
  for each row execute function public.tg_bump_counter('public.post', 'post_id', 'attachment_count');

create trigger listing_image_counter
  after insert or delete on public.listing_image
  for each row execute function public.tg_bump_counter('public.listing', 'listing_id', 'image_count');

-- --------------------------------------------------------------------
-- 17.4 Post -> board counters
-- --------------------------------------------------------------------
create or replace function public.tg_post_board_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.board
       set post_count = post_count + 1,
           last_post_at = greatest(coalesce(last_post_at, new.created_at), new.created_at)
     where id = new.board_id;
    -- Denormalise the board's university onto the post for the campus feed.
    if new.university_id is null then
      update public.post p set university_id = b.university_id
        from public.board b where b.id = new.board_id and p.id = new.id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.board set post_count = greatest(0, post_count - 1) where id = old.board_id;
  end if;
  return null;
end$$;

create trigger post_board_counts
  after insert or delete on public.post
  for each row execute function public.tg_post_board_counts();

-- --------------------------------------------------------------------
-- 17.5 Poll counters
-- --------------------------------------------------------------------
create or replace function public.tg_poll_vote_counts() returns trigger
language plpgsql as $$
declare v_post uuid; v_option uuid; v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_post := new.post_id; v_option := new.option_id; v_delta := 1;
  else
    v_post := old.post_id; v_option := old.option_id; v_delta := -1;
  end if;

  update public.poll_option set vote_count = greatest(0, vote_count + v_delta) where id = v_option;

  -- total_votes counts distinct VOTERS, not ballots, so a multi-choice
  -- poll cannot inflate its own denominator.
  update public.poll p
     set total_votes = (select count(distinct pv.app_user_id) from public.poll_vote pv where pv.post_id = v_post)
   where p.post_id = v_post;
  return null;
end$$;

create trigger poll_vote_counts
  after insert or delete on public.poll_vote
  for each row execute function public.tg_poll_vote_counts();

-- --------------------------------------------------------------------
-- 17.6 Absence -> enrollment counters
-- --------------------------------------------------------------------
create or replace function public.tg_absence_counts() returns trigger
language plpgsql as $$
declare
  v_enrollment uuid := coalesce(new.enrollment_id, old.enrollment_id);
  v_section uuid;
  v_late_weight numeric;
begin
  select e.section_id into v_section from public.enrollment e where e.id = v_enrollment;
  select l.late_counts_as into v_late_weight from ref.effective_absence_limit(v_section) l;

  update public.enrollment e
     set absence_count = sub.cnt,
         absence_units = sub.units
    from (
      select count(*) filter (where a.kind <> 'excused') as cnt,
             coalesce(sum(case a.kind
                            when 'absent' then 1
                            when 'late'   then coalesce(v_late_weight, 0.5)
                            else 0 end), 0) as units
        from public.absence a
       where a.enrollment_id = v_enrollment
    ) sub
   where e.id = v_enrollment;
  return null;
end$$;

create trigger absence_counts
  after insert or update or delete on public.absence
  for each row execute function public.tg_absence_counts();

-- --------------------------------------------------------------------
-- 17.7 Review -> summary tables
-- Sums and histogram buckets only; averages are generated columns and
-- top_tags is recomputed on a schedule.
-- --------------------------------------------------------------------
create or replace function public.tg_review_summaries() returns trigger
language plpgsql as $$
declare
  -- PL/pgSQL cannot mix a record variable with a scalar in a FOR target
  -- (`for r, v_sign in ...` is a syntax error), so the pair is carried as
  -- one composite row and unpacked at the top of the loop.
  rec    record;
  r      public.review%rowtype;
  v_sign integer;
begin
  -- Apply the old row negatively and the new row positively; an UPDATE
  -- runs both halves, which makes edits exact.
  for rec in
    select old as rev, -1 as sign where tg_op in ('UPDATE', 'DELETE')
    union all
    select new as rev,  1 as sign where tg_op in ('UPDATE', 'INSERT')
  loop
    r      := rec.rev;
    v_sign := rec.sign;
    insert into public.instructor_review_summary as s (instructor_id, review_count, rating_sum,
           star_1, star_2, star_3, star_4, star_5,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.instructor_id, v_sign, v_sign * r.overall_rating,
            v_sign * (r.overall_rating = 1)::int, v_sign * (r.overall_rating = 2)::int,
            v_sign * (r.overall_rating = 3)::int, v_sign * (r.overall_rating = 4)::int,
            v_sign * (r.overall_rating = 5)::int,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (instructor_id) do update set
      review_count   = s.review_count   + excluded.review_count,
      rating_sum     = s.rating_sum     + excluded.rating_sum,
      star_1         = s.star_1         + excluded.star_1,
      star_2         = s.star_2         + excluded.star_2,
      star_3         = s.star_3         + excluded.star_3,
      star_4         = s.star_4         + excluded.star_4,
      star_5         = s.star_5         + excluded.star_5,
      quality_sum    = s.quality_sum    + excluded.quality_sum,
      fairness_sum   = s.fairness_sum   + excluded.fairness_sum,
      workload_sum   = s.workload_sum   + excluded.workload_sum,
      attendance_sum = s.attendance_sum + excluded.attendance_sum,
      updated_at     = now();

    insert into public.course_review_summary as cs (course_id, review_count, rating_sum,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.course_id, v_sign, v_sign * r.overall_rating,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (course_id) do update set
      review_count   = cs.review_count   + excluded.review_count,
      rating_sum     = cs.rating_sum     + excluded.rating_sum,
      quality_sum    = cs.quality_sum    + excluded.quality_sum,
      fairness_sum   = cs.fairness_sum   + excluded.fairness_sum,
      workload_sum   = cs.workload_sum   + excluded.workload_sum,
      attendance_sum = cs.attendance_sum + excluded.attendance_sum,
      updated_at     = now();

    insert into public.course_instructor_review_summary as cis (course_id, instructor_id, review_count, rating_sum,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.course_id, r.instructor_id, v_sign, v_sign * r.overall_rating,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (course_id, instructor_id) do update set
      review_count   = cis.review_count   + excluded.review_count,
      rating_sum     = cis.rating_sum     + excluded.rating_sum,
      quality_sum    = cis.quality_sum    + excluded.quality_sum,
      fairness_sum   = cis.fairness_sum   + excluded.fairness_sum,
      workload_sum   = cis.workload_sum   + excluded.workload_sum,
      attendance_sum = cis.attendance_sum + excluded.attendance_sum,
      updated_at     = now();
  end loop;

  -- '3 FƏNN': distinct courses reviewed for this instructor. Cheap
  -- because it is bounded by the instructor's course list.
  update public.instructor_review_summary s
     set course_count = (select count(distinct cis.course_id)
                           from public.course_instructor_review_summary cis
                          where cis.instructor_id = s.instructor_id and cis.review_count > 0)
   where s.instructor_id = coalesce(new.instructor_id, old.instructor_id);

  return null;
end$$;

create trigger review_summaries
  after insert or update or delete on public.review
  for each row execute function public.tg_review_summaries();

-- --------------------------------------------------------------------
-- 17.8 Trade ratings -> app_user reputation
-- --------------------------------------------------------------------
create or replace function public.tg_trade_rating_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.app_user
       set trade_rating_sum = trade_rating_sum + new.score,
           trade_rating_count = trade_rating_count + 1
     where id = new.ratee_id;
  elsif tg_op = 'DELETE' then
    update public.app_user
       set trade_rating_sum = greatest(0, trade_rating_sum - old.score),
           trade_rating_count = greatest(0, trade_rating_count - 1)
     where id = old.ratee_id;
  else
    update public.app_user
       set trade_rating_sum = trade_rating_sum - old.score + new.score
     where id = new.ratee_id;
  end if;
  return null;
end$$;

create trigger trade_rating_counts
  after insert or update or delete on public.trade_rating
  for each row execute function public.tg_trade_rating_counts();

create or replace function public.tg_deal_completed_counts() returns trigger
language plpgsql as $$
begin
  if new.state = 'completed' and coalesce(old.state, 'inquiry') <> 'completed' then
    update public.app_user set deal_count = deal_count + 1 where id in (new.seller_id, new.buyer_id);
  elsif old.state = 'completed' and new.state <> 'completed' then
    update public.app_user set deal_count = greatest(0, deal_count - 1) where id in (new.seller_id, new.buyer_id);
  end if;
  return null;
end$$;

create trigger deal_completed_counts
  after update of state on public.deal
  for each row execute function public.tg_deal_completed_counts();

-- --------------------------------------------------------------------
-- 17.9 RSVP -> attendee_count
-- --------------------------------------------------------------------
create or replace function public.tg_rsvp_counts() returns trigger
language plpgsql as $$
declare v_delta integer := 0;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.state = 'going' then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    v_delta := case when old.state = 'going' then -1 else 0 end;
  else
    v_delta := case when new.state = 'going' then 1 else 0 end
             - case when old.state = 'going' then 1 else 0 end;
  end if;
  if v_delta <> 0 then
    update public.campus_event
       set attendee_count = greatest(0, attendee_count + v_delta)
     where id = coalesce(new.event_id, old.event_id);
  end if;
  return null;
end$$;

create trigger rsvp_counts
  after insert or update or delete on public.event_rsvp
  for each row execute function public.tg_rsvp_counts();

-- --------------------------------------------------------------------
-- 17.10 Chat -> conversation counters + responsiveness facts
-- The COUNTERS are triggered; the DERIVED statistics (response rate,
-- median response time) are recomputed from internal.seller_inquiry.
-- --------------------------------------------------------------------
create or replace function public.tg_chat_message_counts() returns trigger
language plpgsql as $$
declare v_seller uuid;
begin
  update public.conversation
     set message_count = message_count + 1,
         last_message_at = new.created_at
   where id = new.conversation_id;

  update public.conversation_participant
     set unread_count = unread_count + 1
   where conversation_id = new.conversation_id
     and app_user_id <> new.sender_id
     and left_at is null;

  -- Record the inquiry / first response pair for the seller stats.
  select cp.app_user_id into v_seller
    from public.conversation_participant cp
   where cp.conversation_id = new.conversation_id and cp.role = 'seller'
   limit 1;

  if v_seller is not null then
    if new.sender_id <> v_seller then
      insert into internal.seller_inquiry (conversation_id, seller_id, first_inquiry_at)
      values (new.conversation_id, v_seller, new.created_at)
      on conflict (conversation_id) do nothing;
    else
      update internal.seller_inquiry
         set first_response_at = coalesce(first_response_at, new.created_at)
       where conversation_id = new.conversation_id;
    end if;
  end if;
  return null;
end$$;

create trigger chat_message_counts
  after insert on public.chat_message
  for each row execute function public.tg_chat_message_counts();

-- Rolling 90-day recompute of the seller card numbers.
-- Design screen 08: "100% CAVAB", "~2 saat CAVAB VAXTI".
create or replace function public.recompute_seller_stats(p_window interval default interval '90 days')
returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with s as (
    select seller_id,
           count(*)                                        as inquiries,
           count(*) filter (where first_response_at is not null) as responded,
           percentile_cont(0.5) within group (order by response_seconds)
             filter (where response_seconds is not null)   as median_sec
      from internal.seller_inquiry
     where first_inquiry_at > now() - p_window
     group by seller_id
  )
  update public.app_user au
     set response_rate_pct        = round(100.0 * s.responded / nullif(s.inquiries, 0))::smallint,
         response_time_median_sec = s.median_sec::integer
    from s
   where au.id = s.seller_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

-- --------------------------------------------------------------------
-- 17.11 Authored-content counters on app_user
-- --------------------------------------------------------------------
create or replace function public.tg_author_counts() returns trigger
language plpgsql as $$
declare v_col text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    execute format('update public.app_user set %I = %I + 1 where id = $1', v_col, v_col) using new.app_user_id;
  else
    execute format('update public.app_user set %I = greatest(0, %I - 1) where id = $1', v_col, v_col) using old.app_user_id;
  end if;
  return null;
end$$;

create trigger post_author_counts
  after insert or delete on internal.post_author
  for each row execute function public.tg_author_counts('post_count');

create trigger comment_author_counts
  after insert or delete on internal.comment_author
  for each row execute function public.tg_author_counts('comment_count');

create trigger review_author_counts
  after insert or delete on internal.review_author
  for each row execute function public.tg_author_counts('review_count');

-- --------------------------------------------------------------------
-- 17.12 Application count (career -> public)
-- The ONLY write that crosses the career boundary, and it carries a
-- count and nothing else. Reviewed deliberately: an aggregate of this
-- shape cannot leak an applicant's identity.
-- --------------------------------------------------------------------
create or replace function career.tg_application_count() returns trigger
language plpgsql security definer set search_path = career, public, pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.vacancy set application_count = application_count + 1 where id = new.vacancy_id;
  elsif tg_op = 'DELETE' then
    update public.vacancy set application_count = greatest(0, application_count - 1) where id = old.vacancy_id;
  end if;
  return null;
end$$;

create trigger application_count
  after insert or delete on career.application
  for each row execute function career.tg_application_count();

-- --------------------------------------------------------------------
-- 17.13 Scheduled recomputations (pg_cron; schedules live in migration 0016)
--   fold_karma_ledger()          every 1 min
--   recompute_seller_stats()     every 30 min
--   refresh_view_counts()        every 5 min
--   refresh_top_tags()           hourly
--   refresh_complaint_counts()   hourly
--   refresh_absence_limits()     nightly
--   push cohort_size from identity  nightly
-- --------------------------------------------------------------------
create or replace function public.refresh_view_counts() returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with d as (
    delete from internal.view_delta
     where bucket_hour < date_trunc('hour', now())
    returning post_id, delta
  ),
  agg as (select post_id, sum(delta) as delta from d group by post_id)
  update public.post p set view_count = p.view_count + agg.delta
    from agg where p.id = agg.post_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

create or replace function public.refresh_complaint_counts() returns integer
language plpgsql security definer set search_path = public, moderation, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with c as (
    select a.target_app_user_id as app_user_id, count(*) as n
      from moderation.action a
     where a.kind in ('warn', 'mute', 'suspend', 'ban', 'remove_content')
       and a.target_app_user_id is not null
     group by 1
  )
  update public.app_user au set complaint_count = c.n from c where au.id = c.app_user_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

create or replace function public.refresh_absence_limits() returns integer
language plpgsql security definer set search_path = public, ref, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  update public.enrollment e
     set absence_limit = l.max_absences
    from ref.effective_absence_limit(e.section_id) l
   where e.state = 'enrolled'
     and e.absence_limit is distinct from l.max_absences;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;


