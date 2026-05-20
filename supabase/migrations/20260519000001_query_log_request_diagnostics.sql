-- Adds request-diagnostic columns to query_log so the /configuration/search
-- panel can show denials (origin mismatch, instance inactive, etc.) and total
-- handler latency, not just successful searches.
--
-- Backfill strategy: existing rows are all successes (only success path wrote
-- to query_log before this migration), so status defaults to 200 and
-- denial_reason stays NULL. total_handler_ms is NULL for old rows since we
-- never measured it.

ALTER TABLE public.query_log
  ADD COLUMN IF NOT EXISTS status            smallint NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS denial_reason     text     NULL,
  ADD COLUMN IF NOT EXISTS total_handler_ms  integer  NULL;

-- Lock denial_reason to the set of outcomes the /api/v1/search route can
-- actually produce. Update this list when the route grows new failure modes.
ALTER TABLE public.query_log
  DROP CONSTRAINT IF EXISTS query_log_denial_reason_check;
ALTER TABLE public.query_log
  ADD CONSTRAINT query_log_denial_reason_check CHECK (
    denial_reason IS NULL
    OR denial_reason IN (
      'origin_not_authorized',
      'instance_inactive',
      'rate_limited',
      'meilisearch_failed'
    )
  );

COMMENT ON COLUMN public.query_log.status IS
  'HTTP status returned to the caller. 200 = success, 403/429/502 = denial.';
COMMENT ON COLUMN public.query_log.denial_reason IS
  'NULL for status=200. Otherwise the route-level reason the request was rejected.';
COMMENT ON COLUMN public.query_log.total_handler_ms IS
  'Wall-clock time spent inside /api/v1/search. NULL for rows written before this column existed.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260519000001',
  'Search Stage 1: add status / denial_reason / total_handler_ms to query_log for the request-log diagnostic panel'
)
ON CONFLICT (version) DO NOTHING;
