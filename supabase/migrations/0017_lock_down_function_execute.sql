-- Postgres grants EXECUTE on new functions to PUBLIC by default. The schema
-- revoked that for the identity-unsealing functions but not the maintenance
-- ones, leaving six SECURITY DEFINER functions reachable by anon and
-- authenticated through PostgREST RPC.
--
-- refresh_contributor_levels is the serious one: the karma-delta oracle fix
-- (section 20) depends on the badge refreshing on a DELAY so a level change
-- cannot be tied to a specific post. A caller who can trigger the refresh
-- chooses when the badge moves, which is most of the way back to the oracle.
-- The rest are full-table operations and a cheap denial-of-service lever.
--
-- Default-deny, then grant back only what clients genuinely need.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema util   from public, anon;

-- authenticated needs these: SECURITY INVOKER policy expressions are
-- evaluated with the caller's privileges.
grant execute on function
  public.current_app_user_id(),
  public.current_university_id(),
  public.current_tier(),
  public.can_read_board(uuid),
  public.is_conversation_participant(uuid),
  public.is_enrolled_in_section(uuid)
  to authenticated, service_role;

grant execute on function util.fold_text(text), util.fold_handle(text)
  to authenticated, service_role;

grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema util   revoke execute on functions from public;
