-- Per-post, opt-in campus badge for national boards.
--
-- The design shows "BDU" beside an anonymous author, but there was no
-- servable column for it: post.university_id is denormalised from the BOARD,
-- so on a national board it describes the room, not the person. Rendering it
-- as an author attribute would have been simply wrong.
--
-- This makes the badge an explicit act at compose time rather than a standing
-- property of the account. Default is NULL — no badge.
alter table public.post
  add column if not exists author_university_id uuid
    references ref.university(id) on delete set null;

comment on column public.post.author_university_id is
  'OPT-IN per post, national boards only. NULL means the author did not show a campus badge, which is the default. Frozen at write time for the same reason as author_tier: re-deriving it live would rewrite the badge on every past post if the author ever transfers, and would leak that the transfer happened.';

create or replace function public.enforce_author_badge_scope() returns trigger
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_scope public.board_scope;
begin
  if new.author_university_id is null then
    return new;
  end if;

  select b.scope into v_scope from public.board b where b.id = new.board_id;

  if v_scope is distinct from 'national' then
    raise exception
      'author_university_id may only be set on a national board (board scope is %)', v_scope
      using errcode = 'check_violation';
  end if;

  return new;
end$$;

create trigger post_author_badge_scope
  before insert or update of author_university_id, board_id on public.post
  for each row execute function public.enforce_author_badge_scope();

-- The server layer is responsible for setting this to the CALLER's own
-- university. It cannot be enforced here: authorship lives in
-- internal.post_author, which is written after the post row, so a BEFORE
-- trigger cannot see it. Asserted in the API test suite instead.

create index if not exists post_author_university_idx
  on public.post (author_university_id)
  where author_university_id is not null;

revoke execute on function public.enforce_author_badge_scope() from public, anon, authenticated;
