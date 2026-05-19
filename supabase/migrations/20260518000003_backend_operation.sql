-- Backend-call observability foundation (Phase Now).
--
-- Problem this solves: backend integration calls (Meilisearch indexing,
-- WooCommerce pulls, settings pushes, …) are fire-and-forget. When a
-- Meilisearch index task is enqueued the SDK returns a task uid immediately;
-- nothing polls the task, nothing persists the response. A product that
-- fails to land in the index leaves no diagnostic trace and the sync action
-- still reports success.
--
-- This table is the persistent audit trail every backend call writes to:
-- one row per discrete operation, opened 'pending', closed 'succeeded' /
-- 'failed' / 'partial' once the real outcome is known (e.g. after polling
-- the Meilisearch task to completion).
--
-- Phase Next (separate work) builds the right-pane Activity Stream UI on top
-- of this data. This migration only creates the data foundation. Additive
-- and safe to apply to production — no existing table is altered.

CREATE TABLE IF NOT EXISTS public.backend_operation (
  operation_id      bigserial PRIMARY KEY,
  instance_id       bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,

  -- e.g. 'meilisearch_index', 'meilisearch_settings_push',
  -- 'woocommerce_pull', 'meilisearch_delete'. Free text on purpose — new
  -- operation types must not require a migration.
  operation_type    text NOT NULL,

  -- Stable external identifier the operation acted on: product
  -- woocommerce_id, category slug, etc. NULL for bulk/instance-wide ops.
  target_id         text NULL,

  -- Summary of what was sent — key fields only, never the full payload.
  -- e.g. {"index_name":"scout_products_4","doc_count":1,"product_id":123}.
  payload_summary   jsonb NULL,

  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'succeeded', 'failed', 'partial')),

  -- Full response from the backend: Meilisearch task object (uid, status,
  -- error.message, error.code, error.type), WC response body, etc.
  response_payload  jsonb NULL,

  -- Human-readable error summary when status IN ('failed','partial').
  error_message     text NULL,

  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz NULL,            -- NULL while pending
  duration_ms       integer NULL                 -- computed on completion
);

-- Recent-activity feed per instance (the future Activity Stream query).
CREATE INDEX IF NOT EXISTS idx_backend_operation_instance_completed
  ON public.backend_operation (instance_id, completed_at DESC);

-- Filter by operation type + outcome ("all failed meilisearch_index ops").
CREATE INDEX IF NOT EXISTS idx_backend_operation_type_status
  ON public.backend_operation (operation_type, status);

-- "Every operation that touched this product/target".
CREATE INDEX IF NOT EXISTS idx_backend_operation_target_type
  ON public.backend_operation (target_id, operation_type);

COMMENT ON TABLE public.backend_operation IS
  'Persistent audit trail for backend integration calls (Meilisearch, '
  'WooCommerce, …). One row per discrete operation; opened pending, closed '
  'succeeded/failed/partial once the real outcome is confirmed (e.g. after '
  'polling a Meilisearch task). Foundation for the Activity Stream UI.';

COMMENT ON COLUMN public.backend_operation.payload_summary IS
  'Key fields of what was sent — a summary, NOT the full payload.';

COMMENT ON COLUMN public.backend_operation.response_payload IS
  'Full backend response: Meilisearch task object (uid/status/error), WC body, etc.';

-- RLS — same pattern as product_sync_status / sync_log / failed_indexing:
-- reads scoped to the caller's instances, writes via the service-role client.
ALTER TABLE public.backend_operation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backend_operation_select ON public.backend_operation;
CREATE POLICY backend_operation_select
  ON public.backend_operation
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies: the indexer/sync actions write through
-- the service-role client, which bypasses RLS. Authenticated users never
-- write here directly.

-- ─── Bookkeeping ──────────────────────────────────────────────────────────

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260518000003',
  'Backend-call observability: backend_operation audit table (Phase Now foundation for the Activity Stream)'
);
