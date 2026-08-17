-- Kiksu content seed: users, forum threads, and reviews.
--
-- Split from seed.sql because this half touches the identity model and must be
-- got right rather than merely got in. Anonymous authorship lives in
-- internal.post_author / internal.comment_author, NEVER in
-- public.post.author_app_user_id (which stays NULL for anonymous posts and is
-- populated only for deliberately-identified staff or club posts). Thread
-- aliases are allocated through internal.allocate_thread_alias() so the OP
-- holds ordinal 1 and the gapless reclaim rule is exercised, rather than being
-- hand-written into internal.thread_alias.
--
-- LOCAL DEVELOPMENT ONLY: this inserts auth.users rows. Do not run it against a
-- Supabase project you care about — see SEED-NOTES.md open question 1.

begin;

-- ---------------------------------------------------------------------
-- Users. Handles follow the generated adjective-noun-number format the
-- design shows (sakit-pərvanə-37, quru-püstə-19) — never user-chosen.
-- ---------------------------------------------------------------------
create temporary table _seed_users(handle text, tier text, uni_code text) on commit drop;
insert into _seed_users values
  ('sakit-pərvanə-37','email_verified','BDU'), ('quru-püstə-19','card_verified','BDU'),
  ('uzaq-ceyran-52','email_verified','BDU'),   ('isti-nar-08','card_verified','BDU'),
  ('mavi-turac-71','email_verified','BDU'),    ('dinc-alma-24','email_verified','BDU'),
  ('yaşıl-ənbər-63','card_verified','BDU'),    ('sərin-badam-15','email_verified','BDU'),
  ('geniş-şanapipik-90','email_verified','BDU'),('qədim-heyva-46','card_verified','BDU'),
  ('açıq-zeytun-33','email_verified','ADA'),   ('uca-qarağac-77','email_verified','UNEC');

insert into auth.users (id)
select gen_random_uuid() from _seed_users
on conflict do nothing;

-- Pair each generated auth user with a handle, deterministically by row order.
insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status, karma)
select au.id, su.handle, u.id, su.tier::public.verification_tier, 'active',
       (row_number() over ()) * 47   -- spread of karma; contributor_level is set by cron, not here
  from (select id, row_number() over (order by id) rn from auth.users
         where id not in (select auth_user_id from public.app_user)) au
  join (select *, row_number() over () rn from _seed_users) su on su.rn = au.rn
  join ref.university u on u.code = su.uni_code
on conflict (handle) do nothing;

-- ---------------------------------------------------------------------
-- A helper that creates an anonymous thread the way the API must: the post
-- row carries only RENDERED identity, authorship goes to internal, and the
-- alias comes from the allocator so the OP provably gets ordinal 1.
-- ---------------------------------------------------------------------
create or replace function pg_temp.seed_thread(
  p_board_slug text, p_handle text, p_title text, p_body text,
  p_score integer, p_saves integer, p_uni_badge text default null
) returns uuid language plpgsql as $$
declare
  v_board uuid; v_user uuid; v_post uuid; v_alias integer; v_badge uuid;
begin
  select id into v_board from public.board where slug = p_board_slug;
  select id into v_user  from public.app_user where handle = p_handle;
  if p_uni_badge is not null then
    select id into v_badge from ref.university where code = p_uni_badge;
  end if;

  insert into public.post (board_id, university_id, title, body, author_display_mode,
                           author_alias_number, author_tier, author_university_id)
  select v_board, b.university_id, p_title, p_body, 'alias', 1, au.verification_tier, v_badge
    from public.board b, public.app_user au
   where b.id = v_board and au.id = v_user
  returning id into v_post;

  -- Authorship: internal only. This is the whole anonymity model in one line.
  insert into internal.post_author (post_id, app_user_id) values (v_post, v_user);

  -- Alias through the allocator, not hand-written. Asserts the OP gets 1.
  v_alias := internal.allocate_thread_alias(v_post, v_user, interval '5 min', true);
  if v_alias <> 1 then
    raise exception 'OP should hold alias 1, got % (identity spec P4)', v_alias;
  end if;
  update internal.thread_alias set is_op = true
   where post_id = v_post and app_user_id = v_user;

  update public.post set score = p_score, upvote_count = p_score, save_count = p_saves
   where id = v_post;
  return v_post;
end$$;

create or replace function pg_temp.seed_comment(
  p_post uuid, p_handle text, p_body text, p_score integer
) returns void language plpgsql as $$
declare v_user uuid; v_alias integer; v_seq integer; v_cid uuid;
begin
  select id into v_user from public.app_user where handle = p_handle;
  -- Alias is per-thread and assigned on first participation; a commenter who
  -- already posted in this thread keeps their existing ordinal.
  v_alias := internal.allocate_thread_alias(p_post, v_user, interval '5 min', true);
  select coalesce(max(seq_in_post), 0) + 1 into v_seq
    from public.post_comment where post_id = p_post;

  insert into public.post_comment (post_id, seq_in_post, path, depth, body,
                                   author_display_mode, author_alias_number, author_tier,
                                   is_op, score, upvote_count)
  select p_post, v_seq, array[v_seq], 0, p_body, 'alias', v_alias, au.verification_tier,
         exists (select 1 from internal.post_author pa
                  where pa.post_id = p_post and pa.app_user_id = v_user),
         p_score, p_score
    from public.app_user au where au.id = v_user
  returning id into v_cid;

  insert into internal.comment_author (comment_id, app_user_id) values (v_cid, v_user);
end$$;

-- ---------------------------------------------------------------------
-- The design's headline thread, verbatim from the Post Detail screen.
-- ---------------------------------------------------------------------
do $$
declare v_post uuid;
begin
  v_post := pg_temp.seed_thread(
    'bdu-ders-ve-muellim', 'sakit-pərvanə-37',
    'Mikroiqtisadiyyat aralıq imtahanı təxirə salındı, kim eşitdi?',
    'Dekanlıqdan hələ rəsmi elan yoxdur, ancaq qrup nümayəndəsi cümə axşamına keçirildiyini dedi. Prof. Quliyeva dərsdə bir şey demədi. Təsdiq edən var?',
    211, 18);
  perform pg_temp.seed_comment(v_post, 'quru-püstə-19',
    'Bizim qrupa da eyni məlumat gəldi. Cümə axşamı 11:00, 205 otaq.', 46);
  perform pg_temp.seed_comment(v_post, 'uzaq-ceyran-52',
    '205 deyil, 207 olacaq. Elan lövhəsində dəyişiklik var.', 19);
  perform pg_temp.seed_comment(v_post, 'isti-nar-08',
    'Rəsmi elan gəlməyincə heç nəyə inanmayın, keçən semestr də belə oldu.', 11);

  perform pg_temp.seed_thread('bdu-ders-ve-muellim', 'mavi-turac-71',
    'Alqoritmlər lab. tapşırığının cavab formatı belədirmi?',
    'Müəllim PDF istədi, amma qrupda .ipynb göndərənlər var. Kim dəqiq bilir?', 34, 4);

  perform pg_temp.seed_thread('bdu-serbest-sohbet', 'dinc-alma-24',
    'Kitabxana axşam 22:00-a qədər açıq olacaq — imtahan dövrü',
    'Bu gün elan vurulub. Sessiya bitənə qədər davam edir.', 324, 41);

  perform pg_temp.seed_thread('bdu-yataqxana', 'yaşıl-ənbər-63',
    'Yasamalda kirayə qiymətləri necədir bu il?',
    'İki otaqlı üçün 700-800 manat deyirlər. Real təcrübəsi olan varmı?', 96, 22);

  -- Opt-in campus badge: only legal on a national board, and only because
  -- this author deliberately ticked the box.
  perform pg_temp.seed_thread('milli-serbest', 'qədim-heyva-46',
    'Universitetlərarası proqramlaşdırma yarışına komanda axtarılır',
    'Noyabrda keçiriləcək. 3 nəfərlik komanda lazımdır, ACM formatı.', 148, 37, 'BDU');
end$$;

-- ---------------------------------------------------------------------
-- A poll, matching the design: Data Mining 64% / Kompilyatorlar 36%, 428 votes.
-- ---------------------------------------------------------------------
do $$
declare v_post uuid;
begin
  v_post := pg_temp.seed_thread('bdu-ders-ve-muellim', 'sərin-badam-15',
    'Seçmə fənn: “Data Mining” yoxsa “Kompilyatorlar”?',
    'İkisini də götürmək mümkün deyil, birini seçmək lazımdır.', 88, 9);
  update public.post set kind = 'poll' where id = v_post;
  insert into public.poll (post_id, question, closes_at, total_votes)
  values (v_post, 'Hansını seçirsiniz?', now() + interval '2 days', 428);
  insert into public.poll_option (post_id, position, label, vote_count) values
    (v_post, 1, 'Data Mining', 274),      -- 64%
    (v_post, 2, 'Kompilyatorlar', 154);   -- 36%
end$$;

-- ---------------------------------------------------------------------
-- Reviews for dos. Nigar Əliyeva. The design shows 4.2 overall from 61
-- reviews with histogram 5:35 4:16 3:7 2:2 1:1 (= 61). The summary tables are
-- trigger-maintained, so these individual rows must genuinely add up to that
-- rather than the aggregate being written directly.
-- ---------------------------------------------------------------------
do $$
declare
  v_uni uuid; v_course uuid; v_instr uuid; v_term uuid; v_author uuid; v_review uuid;
  v_stars integer[] := array[5,4,3,2,1];
  v_counts integer[] := array[35,16,7,2,1];
  i integer; j integer;
begin
  select id into v_uni from ref.university where code = 'BDU';
  select id into v_course from ref.course where code = 'CS 214' and university_id = v_uni;
  select id into v_instr from ref.instructor where slug = 'nigar-eliyeva';
  select id into v_term from ref.term where university_id = v_uni and is_current;
  select id into v_author from public.app_user where handle = 'sakit-pərvanə-37';

  for i in 1..array_length(v_stars, 1) loop
    for j in 1..v_counts[i] loop
      insert into public.review (university_id, course_id, instructor_id, term_id,
                                 overall_rating, quality, fairness, workload,
                                 attendance_strictness, body, is_enrollment_verified)
      -- Per-star lookups rather than arithmetic on the overall rating. The
      -- design publishes specific criterion averages (quality 4.6, fairness
      -- 4.0, workload 3.5, attendance strictness 2.9) and these values are
      -- chosen so the weighted means over the 35/16/7/2/1 histogram actually
      -- land there. A formula derived from the star gets the shape right and
      -- the numbers wrong.
      values (v_uni, v_course, v_instr, v_term, v_stars[i],
              -- indexed by the star value itself: [star1, star2, ... star5]
              (array[3,4,4,4,5])[v_stars[i]],   -- quality    -> 4.6
              (array[3,3,4,4,4])[v_stars[i]],   -- fairness   -> 4.0
              (array[5,5,4,4,3])[v_stars[i]],   -- workload   -> 3.5
              (array[1,2,3,3,3])[v_stars[i]],   -- strictness -> 2.9
              case when j = 1 and v_stars[i] = 5
                     then 'İzahları çox səlis, normalizasiya mövzusunu lövhədə addım-addım göstərir. Laboratoriya tapşırıqları imtahana birbaşa hazırlayır.'
                   when j = 1 and v_stars[i] = 3
                     then 'Dərs güclüdür, amma davamiyyəti çox ciddi tutur. Gecikməyə görə qayıb yazır, buna hazır olun.'
                   else null end,
              true)
      returning id into v_review;
      -- Review authorship is internal, exactly like posts.
      insert into internal.review_author (review_id, app_user_id, course_id, instructor_id, term_id)
      values (v_review, v_author, v_course, v_instr, v_term)
      on conflict do nothing;
    end loop;
  end loop;
end$$;

commit;
