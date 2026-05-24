-- Blog search — Postgres full-text search on the post table.
--
-- Decision: Postgres FTS over Meilisearch for this use case. Reasons:
-- 1. Adequate for the ~tens-to-low-hundreds of posts a writer's blog
--    will ever have.
-- 2. Zero extra infra; no separate index to keep in sync.
-- 3. Instant indexing — trigger fires on the same transaction as the
--    write, so search hits land the moment the post is saved.
-- 4. Reading-time queries hit the same connection that already serves
--    /blog; no token, no extra round-trip.
--
-- If posts grow into the thousands or the writer wants typo tolerance
-- + synonyms across content, swap to Meilisearch later — the search
-- API call sites are isolated.
--
-- Text config: 'simple' (no stemming, no stopword removal). Posts may
-- be in Spanish OR English; 'simple' handles both without picking one
-- language's stemmer. Cost: a misspelled query won't match; a search
-- for "running" won't find "ran". Acceptable for a small blog.

alter table public.post add column search_vector tsvector;

create or replace function public.post_set_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.summary, '')), 'B')
    || setweight(
         to_tsvector(
           'simple',
           regexp_replace(coalesce(new.content, ''), '<[^>]+>', ' ', 'g')
         ),
         'C'
       )
    || setweight(
         to_tsvector('simple', array_to_string(coalesce(new.tags, '{}'), ' ')),
         'B'
       );
  return new;
end;
$$;

create trigger post_search_vector_update
  before insert or update of title, summary, content, tags
  on public.post
  for each row execute function public.post_set_search_vector();

create index post_search_vector_idx
  on public.post using gin (search_vector);

-- Backfill any pre-existing rows. Match the trigger body verbatim.
update public.post
   set search_vector =
     setweight(to_tsvector('simple', coalesce(title, '')), 'A')
     || setweight(to_tsvector('simple', coalesce(summary, '')), 'B')
     || setweight(
          to_tsvector(
            'simple',
            regexp_replace(coalesce(content, ''), '<[^>]+>', ' ', 'g')
          ),
          'C'
        )
     || setweight(
          to_tsvector('simple', array_to_string(coalesce(tags, '{}'), ' ')),
          'B'
        );
