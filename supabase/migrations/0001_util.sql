-- =====================================================================
-- 03. UTIL — id generation, timestamps, text folding, FTS configuration
-- =====================================================================

-- --------------------------------------------------------------------
-- 03.1 UUID v7 — SEALED SCHEMAS ONLY
-- Postgres 17 has no native uuidv7 (that lands in 18).
--
-- Time-ordered keys reduce index write amplification on append-heavy
-- tables, which is why this exists. But a v7 id is a timestamp anyone can
-- read, so it must NEVER back a row whose id is returned to a client. Use
-- it only in internal.* and identity.*; everything in public/ref/career
-- uses gen_random_uuid(). See the conventions note above.
-- --------------------------------------------------------------------
create or replace function util.uuid_v7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
      52, 1),
    53, 1), 'hex')::uuid;
$$;

comment on function util.uuid_v7() is
  'RFC 9562 UUIDv7. Replace with the built-in uuidv7() when the project moves to Postgres 18.';

-- --------------------------------------------------------------------
-- 03.2 updated_at
-- --------------------------------------------------------------------
create or replace function util.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

-- --------------------------------------------------------------------
-- 03.3 Text folding — the Azerbaijani search problem
--
-- Requirements:
--   * ə ğ ı ö ş ü ç must match their ASCII skeletons, because students
--     habitually type `e` for `ə` ("mualim", "pervane", "kecid").
--   * Russian content (Cyrillic) must survive folding intact apart from
--     ё -> е, which is the standard Russian search equivalence.
--   * The Azerbaijani dotted/dotless I trap: lower('İ') produces TWO
--     codepoints, 'i' + U+0307 COMBINING DOT ABOVE. If that combining
--     mark is not stripped, "İqtisad" and "iqtisad" do not match.
--     lower('I') produces 'i' in a non-Turkish locale, which conflates
--     I/ı — that is exactly what we want, because we fold ı -> i anyway.
--
-- The function must be IMMUTABLE because generated tsvector columns and
-- expression indexes depend on it. normalize(), lower(), translate() and
-- regexp_replace() are all immutable, so the composition is too.
--
-- OPERATIONAL HAZARD: CREATE OR REPLACE on this function silently
-- invalidates every stored generated column and expression index built
-- on it. Changing the fold rules is a migration, not an edit. See
-- docs/01-schema-notes.md ("Changing the fold rules") for the PG17
-- ALTER TABLE ... ALTER COLUMN ... SET EXPRESSION AS recipe.
-- --------------------------------------------------------------------
create or replace function util.fold_text(txt text) returns text
language sql immutable parallel safe strict as $$
  select translate(
           lower(normalize(txt, NFKC)),
           -- from: az specific + cyrillic yo + combining dot above
           'əğıöşüçё' || U&'\0307',
           -- to:   one shorter than `from`, so U+0307 is DELETED
           'egiosuc'  || U&'\0435'
         );
$$;

comment on function util.fold_text(text) is
  'Diacritic/script folding for search and for uniqueness keys. ə->e ğ->g ı->i ö->o ş->s ü->u ç->c ё->е, strips U+0307. IMMUTABLE: do not edit in place, migrate.';

-- Handle/slug folding also removes separators, so that `sakit-pərvanə-37`
-- and `sakitpervane37` collapse to the same uniqueness key. Without this,
-- diacritic-swapped lookalike handles are an impersonation vector.
create or replace function util.fold_handle(txt text) returns text
language sql immutable parallel safe strict as $$
  select regexp_replace(util.fold_text(txt), '[^a-z0-9]', '', 'g');
$$;

-- --------------------------------------------------------------------
-- 03.4 Full-text search configurations
--
-- There is no Azerbaijani stemmer in Postgres and writing one is out of
-- scope, so Azerbaijani uses `simple` (no stemming) over folded text.
-- Russian and English keep their real stemmers — folding leaves Cyrillic
-- and ASCII words untouched, so the stemmers still work.
-- --------------------------------------------------------------------
create text search configuration util.az (copy = pg_catalog.simple);
comment on text search configuration util.az is
  'Azerbaijani: `simple` tokenizer over util.fold_text() output. No stemmer exists; prefix + trigram indexes compensate.';

create text search configuration util.ru (copy = pg_catalog.russian);
create text search configuration util.en (copy = pg_catalog.english);

-- Maps a board/post/listing language code to a config. IMMUTABLE, so it
-- can be used inside GENERATED ALWAYS AS (...) STORED columns — that is
-- the whole point: the tsvector is derived from the row's own `lang`
-- column with zero trigger code.
create or replace function util.ts_config(lang text) returns regconfig
language sql immutable parallel safe as $$
  select case lang
           when 'ru' then 'util.ru'::regconfig
           when 'en' then 'util.en'::regconfig
           else           'util.az'::regconfig
         end;
$$;

-- Standard two-field weighted vector. A = title, B = body.
create or replace function util.tsv_ab(lang text, a text, b text) returns tsvector
language sql immutable parallel safe as $$
  select setweight(to_tsvector(util.ts_config(lang), util.fold_text(coalesce(a, ''))), 'A')
      || setweight(to_tsvector(util.ts_config(lang), util.fold_text(coalesce(b, ''))), 'B');
$$;

-- Query side MUST use this so that the query text is folded identically.
-- websearch_to_tsquery gives users quoted phrases and -exclusion for free.
create or replace function util.tsq(lang text, q text) returns tsquery
language sql stable parallel safe as $$
  select websearch_to_tsquery(util.ts_config(lang), util.fold_text(coalesce(q, '')));
$$;

comment on function util.tsq(text, text) is
  'Always build queries with this. Folding the query and not the index (or vice versa) is the classic way to break Azerbaijani search.';

-- --------------------------------------------------------------------
-- 03.5 Reddit-style hot ranking
-- The formula is time-ANCHORED, not decaying: the value only changes when
-- the score changes, so a stored column stays correct forever and a
-- plain btree on it is a valid feed ordering. Epoch base = 2025-01-01.
-- --------------------------------------------------------------------
create or replace function util.hot_rank(score integer, created_at timestamptz) returns double precision
language sql immutable parallel safe as $$
  select round(
           (sign(score)::numeric * log(greatest(abs(score), 1)::numeric + 1))
           + ((extract(epoch from created_at) - 1735689600) / 45000.0)::numeric
         , 7)::double precision;
$$;

-- CAVEAT: extract(epoch from timestamptz) is declared STABLE by
-- Postgres (some extract fields depend on TimeZone; `epoch` does not).
-- We therefore do NOT use hot_rank in a generated column — post.hot_rank
-- is maintained by the same trigger that maintains post.score. Do not add
-- a now() term here: the ranking must be an anchored constant per score
-- value, otherwise every feed read would need a full-table rescore.


