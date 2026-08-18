-- Automod decisions are actions too.
--
-- moderation.appeal.action_id is NOT NULL and references moderation.action, so
-- an appeal can only ever contest a recorded ACTION. Human decisions have one:
-- AdminService.decideModeration inserts a row for every kind it accepts.
-- Automod does not — ModerationService.classifyOnWrite opens a mod_case,
-- returns 'limited', and stops there.
--
-- The consequence is the gap this migration exists to close: content limited
-- by the classifier has, structurally, nothing to appeal against. Adding an
-- appeals endpoint alone would not have fixed it, because there would be no
-- action_id to point at.

-- ---------------------------------------------------------------------
-- 25.1 A verb for what the classifier actually does
-- ---------------------------------------------------------------------
-- The existing action_kind values are human verbs — remove_content, warn,
-- mute, suspend, ban, shadowban, unban, escalate_legal, restore_content,
-- no_action. None of them describes limiting.
--
-- Reusing remove_content would be the tempting shortcut and it would be a lie
-- told to a student: limiting hides content pending review, removal is a
-- decision already taken. A person reading "your post was removed" when it was
-- actually held has been given the wrong thing to appeal, and the wrong idea
-- of what happened to them.
--
-- ADD VALUE is not transactional-safe to use in the same statement batch that
-- writes it, which is why nothing here inserts one; the writer is application
-- code in a later transaction.
alter type moderation.action_kind add value if not exists 'limit';

comment on type moderation.action_kind is
  'What was decided on a case. Mostly human verbs; ''limit'' is the classifier''s, recorded with actor_staff_id null because no person decided it. An appeal contests one of these rows, so anything that changes what a student sees MUST write one.';

-- ---------------------------------------------------------------------
-- 25.2 Finding a person's own moderation history
-- ---------------------------------------------------------------------
-- GET /v1/me/moderation answers "what was done to my content", which means
-- walking from an app_user to the actions against content they wrote. The
-- authorship tables are the only route — public.post carries no author — and
-- they are indexed by content id, not by user.
--
-- internal.post_author already has (app_user_id) covered for the own-row reads
-- that existed before; comment and review authorship did not need it. These
-- three make the lookup an index scan rather than a sequential one over every
-- piece of authored content in the product.
create index if not exists post_author_user_idx    on internal.post_author (app_user_id);
create index if not exists comment_author_user_idx on internal.comment_author (app_user_id);
create index if not exists review_author_user_idx  on internal.review_author (app_user_id);

-- The queue join: every action against one target, newest first. Without it,
-- rendering a student's moderation history is a scan of the whole action table
-- per row of theirs.
create index if not exists action_target_idx
  on moderation.action (target_type, target_id, created_at desc);

-- The staff appeals queue reads open appeals in the order they arrived.
create index if not exists appeal_open_idx
  on moderation.appeal (created_at) where state = 'open';
