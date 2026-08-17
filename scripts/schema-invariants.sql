-- Kiksu schema invariants.
--
-- These are the architectural properties that make the anonymity model real.
-- Each one is cheap to check and is exactly the kind of thing a well-meaning
-- future change breaks quietly — a convenient join, a widened view, a helpful
-- extra column. Any failure here is a security regression, not a style nit.
--
-- Run by scripts/verify-schema.sh. Raises on first violation.

do $$
declare
  v_count integer;
  v_cols  text;
begin
  ---------------------------------------------------------------------
  -- 1. The sealed schemas are unreachable to client roles.
  ---------------------------------------------------------------------
  if has_schema_privilege('authenticated', 'identity', 'usage')
     or has_schema_privilege('authenticated', 'career', 'usage')
     or has_schema_privilege('authenticated', 'internal', 'usage') then
    raise exception 'INVARIANT 1 FAILED: authenticated can reach a sealed schema';
  end if;

  if has_schema_privilege('anon', 'identity', 'usage')
     or has_schema_privilege('anon', 'career', 'usage')
     or has_schema_privilege('anon', 'internal', 'usage') then
    raise exception 'INVARIANT 1 FAILED: anon can reach a sealed schema';
  end if;

  ---------------------------------------------------------------------
  -- 2. Layer 4 silo: no FK path from career.* to public.app_user.
  --    Applying for a job must never be linkable to a forum pseudonym.
  ---------------------------------------------------------------------
  select count(*) into v_count
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f'
     and n.nspname = 'career'
     and confrelid::regclass::text like '%app_user%';
  if v_count > 0 then
    raise exception 'INVARIANT 2 FAILED: % FK(s) link career.* to app_user', v_count;
  end if;

  ---------------------------------------------------------------------
  -- 3. No RLS policy reaches into a sealed schema. A policy that did
  --    would need SECURITY DEFINER and would reintroduce the linkage.
  ---------------------------------------------------------------------
  select count(*) into v_count
    from pg_policies
   where qual::text ~ '(internal|identity|career)\.'
      or coalesce(with_check::text, '') ~ '(internal|identity|career)\.';
  if v_count > 0 then
    raise exception 'INVARIANT 3 FAILED: % RLS policy/policies reference a sealed schema', v_count;
  end if;

  ---------------------------------------------------------------------
  -- 4. Every RLS-enabled public table has at least one policy, so no
  --    table is silently locked out entirely.
  ---------------------------------------------------------------------
  select count(*) into v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.tablename = c.relname);
  if v_count > 0 then
    raise exception 'INVARIANT 4 FAILED: % RLS table(s) have no policy', v_count;
  end if;

  ---------------------------------------------------------------------
  -- 5. RLS is enabled on every public table. A new table added without
  --    it is readable by anyone with the anon key.
  ---------------------------------------------------------------------
  select count(*) into v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_count > 0 then
    raise exception 'INVARIANT 5 FAILED: % public table(s) without RLS enabled', v_count;
  end if;

  ---------------------------------------------------------------------
  -- 6. The karma-delta oracle stays closed: authenticated must hold no
  --    column privilege on app_user's sensitive columns.
  ---------------------------------------------------------------------
  select string_agg(column_name, ', ') into v_cols
    from information_schema.column_privileges
   where table_name = 'app_user' and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name in ('karma', 'created_at', 'card_review_state', 'auth_user_id',
                         'complaint_count', 'last_active_at', 'handle_changed_at',
                         'handle_folded', 'suspended_until');
  if v_cols is not null then
    raise exception 'INVARIANT 6 FAILED: authenticated can read sensitive app_user column(s): %', v_cols;
  end if;

  ---------------------------------------------------------------------
  -- 7. public_profiles exposes only the agreed columns. Adding one is a
  --    security change and must fail here until this list is updated
  --    deliberately.
  ---------------------------------------------------------------------
  select string_agg(column_name, ', ' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_profiles';
  if v_cols is distinct from
     'avatar_id, contributor_level, handle, id, university_id, verification_status' then
    raise exception 'INVARIANT 7 FAILED: public_profiles columns changed to: %', v_cols;
  end if;

  ---------------------------------------------------------------------
  -- 8. Anonymous authorship never lands in a client-readable column.
  --    public.post.author_app_user_id is rendered identity, not
  --    authorship; the real map is internal.post_author.
  ---------------------------------------------------------------------
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'internal' and table_name = 'post_author') then
    raise exception 'INVARIANT 8 FAILED: internal.post_author is missing; authorship may have been moved into public';
  end if;

  ---------------------------------------------------------------------
  -- 9. No externally visible table mints a UUIDv7 primary key.
  --    A v7 id embeds a millisecond timestamp, so returning one hands the
  --    caller the row's exact creation instant and defeats the coarse-time
  --    bucketing applied to visible timestamps (threat T9/T11).
  --    v7 is legitimate in internal.* and identity.*, which are sealed.
  ---------------------------------------------------------------------
  select string_agg(c.relname, ', ' order by c.relname) into v_cols
    from pg_attrdef ad
    join pg_class c     on c.oid = ad.adrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'ref', 'career')
     and pg_get_expr(ad.adbin, ad.adrelid) like '%uuid_v7%';
  if v_cols is not null then
    raise exception 'INVARIANT 9 FAILED: exposed table(s) default to UUIDv7: %', v_cols;
  end if;

  ---------------------------------------------------------------------
  -- 10. No SECURITY DEFINER function in public is callable by anon or
  --     authenticated except the RLS helpers. Postgres grants EXECUTE to
  --     PUBLIC by default, so a new SECURITY DEFINER function is exposed
  --     via PostgREST RPC unless explicitly revoked. The one that matters
  --     is refresh_contributor_levels: letting a caller trigger it on
  --     demand defeats the delay that closes the karma-delta oracle.
  ---------------------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))
     and p.proname not in ('current_app_user_id', 'current_university_id',
                           'current_tier', 'can_read_board',
                           'is_conversation_participant', 'is_enrolled_in_section');
  if v_cols is not null then
    raise exception 'INVARIANT 10 FAILED: SECURITY DEFINER function(s) callable by client roles: %', v_cols;
  end if;

  ---------------------------------------------------------------------
  -- 11. The token-mint hook cannot reach the sealed store, and the claims
  --     projection it CAN reach stays exactly six columns.
  --
  --     Identity spec §7.1: "The hook must not be able to read the sealed
  --     store — if it can, every token mint is a sealed-store read." Token
  --     minting is the highest-frequency operation in the product, so a
  --     grant here would turn the sealed store's read-volume budget (tens
  --     of reads per day, §7.4) into millions and destroy the cheapest
  --     detector this design has for identity being wired into a hot path.
  --
  --     The column list is the same control as invariant 7: what keeps a
  --     claim out of every token the product issues is the allowlist, not
  --     anyone remembering why the view is narrow.
  ---------------------------------------------------------------------
  if has_schema_privilege('kiksu_auth_hook_owner', 'identity', 'usage')
     or has_schema_privilege('kiksu_auth_hook_owner', 'career', 'usage') then
    raise exception 'INVARIANT 11 FAILED: the access-token hook role can reach a sealed schema; every token mint is now a sealed-store read';
  end if;

  select string_agg(column_name, ', ' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'internal' and table_name = 'token_claims';
  if v_cols is distinct from
     'app_user_id, auth_user_id, epoch, role, tier, univ_id' then
    raise exception 'INVARIANT 11 FAILED: internal.token_claims columns changed to: %', v_cols;
  end if;

  raise notice 'All 11 schema invariants hold.';
end$$;
