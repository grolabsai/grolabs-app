-- Conversion-Measurement Foundations (B1) — query_log: commitment + identity.
--
-- See docs/design/event-tracking.md (the tracking store) and
-- docs/design/conversion-measurement-foundations.md (the KPI grammar that reads it).
--
-- Two gaps this closes on the search half of the precise spine:
--
--  1. COMMITMENT. The typeahead fires the *logged* /api/v1/search on every
--     debounced keystroke, so query_log mixes prefix probes with real searches
--     and has no flag to tell them apart. Every search-quality KPI is polluted
--     until committed searches are separable. Commitment is marked at capture
--     time by the *caller*: the results-page (PHP) search is committed; the
--     typeahead (JS) search is a prefix probe. is_committed + commit_reason.
--
--  2. IDENTITY (Option B, device tier). account_id is the opaque, stable handle
--     for a logged-in storefront customer (the merchant's WooCommerce account,
--     hashed — never the raw WC id, never PII). Anonymous shoppers stay on
--     user_id (the persistent browser id); account_id is the login merge point.
--
-- All three columns are nullable + backfill-free, consistent with the existing
-- query_log bridge columns (user_id / query_uid / intent_group_id):
--   - is_committed NULL  = pre-migration / unknown (can't be reconstructed).
--   - is_committed TRUE  = committed search (results page, Enter, engagement).
--   - is_committed FALSE = typeahead prefix probe — exclude from quality KPIs.

ALTER TABLE public.query_log
  ADD COLUMN IF NOT EXISTS is_committed  boolean NULL,
  ADD COLUMN IF NOT EXISTS commit_reason text    NULL,
  ADD COLUMN IF NOT EXISTS account_id    text    NULL;

-- Search-quality KPIs read only committed searches; index that slice.
CREATE INDEX IF NOT EXISTS query_log_instance_committed_idx
  ON public.query_log (instance_id, created_at)
  WHERE is_committed IS TRUE;

-- Journey/intent stitching by registered identity.
CREATE INDEX IF NOT EXISTS query_log_instance_account_idx
  ON public.query_log (instance_id, account_id)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN public.query_log.is_committed IS
  'TRUE = committed search (results-page / Enter / engagement); FALSE = typeahead prefix probe (exclude from search-quality KPIs); NULL = pre-migration/unknown. Marked at capture time by the caller, not reconstructed.';
COMMENT ON COLUMN public.query_log.commit_reason IS
  'Why the search counted as committed: results_page | enter | engagement | typeahead | NULL. Diagnostic companion to is_committed.';
COMMENT ON COLUMN public.query_log.account_id IS
  'Opaque, stable id for a logged-in storefront customer (hashed WC user id, never raw, never PII). Soft-joins to analytics_event.account_id. NULL for anonymous shoppers (use user_id). Option B identity, device tier.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000001',
  'B1 conversion-measurement: query_log gains is_committed + commit_reason (committed-search marking) + account_id (Option B identity)'
)
ON CONFLICT (version) DO NOTHING;
