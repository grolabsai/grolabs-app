-- PostHog Analytics MVP — Prompt 2 (the bridge).
--
-- query_log holds the keyword but no join key to conversions; analytics_event
-- has query_uid + user_id but no keyword. This adds the two bridge columns to
-- query_log so "conversion per keyword" and per-user journeys become computable
-- (the analytics bridge described in docs/design/posthog-analytics-mvp.md).
--
-- Both columns are nullable + backfill-free: rows written before this migration
-- (and any future search that omits user_id) simply have NULL, which the
-- soft-join tolerates. query_uid is the Meilisearch query identifier already
-- computed in /api/v1/search; user_id is the anonymous storefront session id.

ALTER TABLE public.query_log
  ADD COLUMN IF NOT EXISTS query_uid text NULL,
  ADD COLUMN IF NOT EXISTS user_id   text NULL;

-- Mirrors analytics_event's partial index so the keyword<->conversion join
-- (query_log.query_uid = analytics_event.query_uid) is indexed on both sides.
CREATE INDEX IF NOT EXISTS query_log_instance_query_uid_idx
  ON public.query_log (instance_id, query_uid)
  WHERE query_uid IS NOT NULL;

COMMENT ON COLUMN public.query_log.query_uid IS
  'Meilisearch query identifier (raw.metadata.queryUid). Soft-joins to analytics_event.query_uid — the keyword<->click/conversion bridge. NULL for rows written before this column existed.';
COMMENT ON COLUMN public.query_log.user_id IS
  'Anonymous storefront session id (grolabs_wordpress_search_session_id). Soft-joins to analytics_event.user_id — journey + intent stitching. NULL when the plugin did not send it.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260603000001',
  'PostHog Analytics MVP P2: add query_uid + user_id bridge columns to query_log (+ partial index on instance_id, query_uid)'
)
ON CONFLICT (version) DO NOTHING;
