-- Durable inbox for storefront telemetry + the query_log column split.
--
-- Per docs/design/direct-meilisearch-search.md Phase 4 (steps 14-15, R-10,
-- R-26). The storefront no longer calls GroLabs to search, so the only way a
-- search reaches query_log is by being REPORTED afterwards. Reporting must
-- therefore be accept-fast and loss-tolerant on our side: take the batch,
-- write it down, answer 202, and do the real work later. Anything that fails
-- after we said 202 is ours to retry, not the shopper's to notice.
--
-- pgmq was the alternative (search-proxy-event-pipeline.md leans that way). A
-- plain append-only table is less to learn, is inspectable with a SELECT, and
-- is enough at current volume -- the decision is recorded here rather than in
-- a commit message so the next person knows it was a choice.

-- ---------------------------------------------------------------------------
-- 1. R-26: stop conflating "hits on this page" with "hits in total"
-- ---------------------------------------------------------------------------
-- query_log.total_hits has always stored hits.length -- the LENGTH OF THE PAGE
-- RETURNED -- while the API response called `total_hits` and returned
-- estimatedTotalHits. Same name, two different numbers. It has never shown up
-- because the test catalogs are small: across 574 logged searches the maximum
-- total_hits is 12, so no query has ever matched more than its page size.
--
-- Direct mode is the moment this becomes unrecoverable: the client now decides
-- what it reports, and if it starts sending the true total into total_hits,
-- the KPI series silently changes meaning mid-flight with no way to tell which
-- rows mean what.
--
-- So it is pinned HERE, before the first direct-mode row is written:
--   total_hits            = the number of hits in the returned page (unchanged)
--   estimated_total_hits  = Meilisearch's estimatedTotalHits for the whole query
--
-- Zero-result detection is unaffected either way (0 is 0). Nullable because
-- every historical row genuinely does not know its total, and backfilling a
-- guess would be worse than admitting that.
alter table public.query_log
  add column if not exists estimated_total_hits integer;

comment on column public.query_log.total_hits is
  'Hits in the RETURNED PAGE (hits.length), not the result total. Capped by the page size. See estimated_total_hits.';
comment on column public.query_log.estimated_total_hits is
  'Meilisearch estimatedTotalHits for the whole query. NULL for rows written before 2026-11-02, which never captured it.';

-- ---------------------------------------------------------------------------
-- 2. Idempotency keys on the destination tables
-- ---------------------------------------------------------------------------
-- The drainer retries, and a retry must not double-count a conversion. The
-- client generates event_id; the drainer upserts on it.
--
-- NOT partial, deliberately. `... where event_id is not null` looks tidier and
-- breaks upserts outright: ON CONFLICT (event_id) can only infer a PARTIAL
-- index if the statement repeats the predicate, which PostgREST's onConflict
-- cannot express, so every drain fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". The predicate buys
-- nothing anyway -- Postgres treats NULLs as distinct in a unique index, so
-- the existing rows with no event_id coexist fine.
alter table public.query_log       add column if not exists event_id text;
alter table public.analytics_event add column if not exists event_id text;

create unique index if not exists query_log_event_id
  on public.query_log (event_id);
create unique index if not exists analytics_event_event_id
  on public.analytics_event (event_id);

-- ---------------------------------------------------------------------------
-- 3. The inbox
-- ---------------------------------------------------------------------------
create table if not exists public.event_inbox (
  event_id     text primary key,
  instance_id  bigint not null references public.instance(instance_id) on delete cascade,
  kind         text   not null,
  payload      jsonb  not null,
  origin       text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 0,
  last_error   text
);

-- The drainer's only query: oldest unprocessed first.
create index if not exists event_inbox_pending
  on public.event_inbox (received_at) where processed_at is null;

-- Lets an operator answer "is the drain keeping up?" without a seq scan.
create index if not exists event_inbox_instance_received
  on public.event_inbox (instance_id, received_at desc);

alter table public.event_inbox enable row level security;

comment on table public.event_inbox is
  'Durable buffer for storefront telemetry. /api/v1/events appends and answers 202; the drainer moves rows into query_log / analytics_event and stamps processed_at. event_id is the client-generated idempotency key -- a retried batch collides here and is ignored rather than double-counted.';
comment on column public.event_inbox.kind is
  'search_performed -> query_log. Everything else -> analytics_event.';
comment on column public.event_inbox.attempts is
  'Incremented on each failed drain. A row with high attempts and a last_error is a poison message, not a backlog.';
