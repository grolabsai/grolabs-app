-- Stage 1 search infrastructure migration.
--
-- Per docs/policy/search-foundations.md §9 (indexing pipeline) + §7 (search proxy).
--
-- Changes:
--   1. Extend product_sync_status / sync_log CHECK constraints to include 'meilisearch'.
--   2. Add instance.last_search_sync_at timestamptz — most recent successful backfill.
--   3. New failed_indexing table — schema-validation failures from the document builder.
--   4. New query_log table — every /api/v1/search call logged for analytics + debugging.

-- ─── 1. Extend platform CHECK constraints ─────────────────────────────────

ALTER TABLE public.product_sync_status
  DROP CONSTRAINT IF EXISTS product_sync_status_platform_check;

ALTER TABLE public.product_sync_status
  ADD CONSTRAINT product_sync_status_platform_check
  CHECK (platform IN ('algolia', 'woocommerce', 'meilisearch'));

ALTER TABLE public.sync_log
  DROP CONSTRAINT IF EXISTS sync_log_platform_check;

ALTER TABLE public.sync_log
  ADD CONSTRAINT sync_log_platform_check
  CHECK (platform IN ('algolia', 'woocommerce', 'meilisearch'));

-- ─── 2. instance.last_search_sync_at ──────────────────────────────────────

ALTER TABLE public.instance
  ADD COLUMN IF NOT EXISTS last_search_sync_at timestamptz NULL;

COMMENT ON COLUMN public.instance.last_search_sync_at IS
  'Timestamp of the most recent successful Meilisearch full backfill for this instance. '
  'Per-product sync timestamps live in product_sync_status (platform=meilisearch).';

-- ─── 3. failed_indexing ───────────────────────────────────────────────────
-- Per §9: when a document fails schema validation, log it here for triage
-- rather than blocking the batch. Append-only.

CREATE TABLE IF NOT EXISTS public.failed_indexing (
  id              bigserial PRIMARY KEY,
  instance_id     bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  product_id      bigint NULL,
  reason          text NOT NULL,
  payload         jsonb NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_indexing_instance_created
  ON public.failed_indexing (instance_id, created_at DESC);

COMMENT ON TABLE public.failed_indexing IS
  'Documents that failed Meilisearch indexing (validation, build, or upsert). '
  'Append-only; Stage 1 admin reads count for the indexing-status panel.';

ALTER TABLE public.failed_indexing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS failed_indexing_select ON public.failed_indexing;
CREATE POLICY failed_indexing_select
  ON public.failed_indexing
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- Writes go through the service-role client from the indexer; no INSERT policy.

-- ─── 4. query_log ─────────────────────────────────────────────────────────
-- Per §7: log query, total_hits, processing_time, variant selection result.
-- Lightweight — one row per /api/v1/search call. Used by Stage 4 analytics.
-- Append-only with TTL cleanup as a future concern.

CREATE TABLE IF NOT EXISTS public.query_log (
  id                    bigserial PRIMARY KEY,
  instance_id           bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  query                 text NOT NULL,
  total_hits            integer NOT NULL DEFAULT 0,
  processing_time_ms    integer NOT NULL DEFAULT 0,
  -- Per-hit matched_variation summary: array of {product_id, variation_id|null}.
  -- Stays small (<= page size). Full document is recoverable from Meili by id.
  variant_selection     jsonb NULL,
  origin                text NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_log_instance_created
  ON public.query_log (instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_log_instance_query
  ON public.query_log (instance_id, query);

COMMENT ON TABLE public.query_log IS
  'Append-only log of every /api/v1/search call. Stage 4 turns this into analytics. '
  'Stage 1 only writes; no read paths beyond ad-hoc admin SQL.';

ALTER TABLE public.query_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS query_log_select ON public.query_log;
CREATE POLICY query_log_select
  ON public.query_log
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- ─── Bookkeeping ──────────────────────────────────────────────────────────

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260510000001',
  'Search Stage 1: extend sync platform enums for meilisearch, add instance.last_search_sync_at, failed_indexing + query_log tables'
);
