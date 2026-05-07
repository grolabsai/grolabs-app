-- Sync status + sync log
-- Tracks per-product, per-platform sync state for the Sync Manager screen
-- and the Algolia/Tienda status columns on /catalog/products.
--
-- Two tables:
--   product_sync_status — current state per (instance, product, platform)
--   sync_log            — history of sync runs

-- ─── product_sync_status ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_sync_status (
  id                  bigserial PRIMARY KEY,
  instance_id         bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  product_id          bigint NOT NULL REFERENCES public.product(product_id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('algolia', 'woocommerce')),

  -- Last successful push (NULL = never synced)
  last_synced_at      timestamptz NULL,
  -- Most recent attempt outcome — informational, may differ from last_synced_at
  last_status         text NULL CHECK (last_status IN ('success', 'error', 'skipped') OR last_status IS NULL),
  last_error          text NULL,

  -- Cached external id so we can update-by-id on subsequent syncs without
  -- re-querying the platform. WooCommerce assigns numeric ids on create;
  -- Algolia uses our SKU as objectID so this is unused for that platform.
  external_id         text NULL,

  -- Hash of the last pushed payload — lets us skip a sync if nothing changed
  last_payload_hash   text NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (instance_id, product_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_product_sync_status_instance
  ON public.product_sync_status (instance_id);

CREATE INDEX IF NOT EXISTS idx_product_sync_status_product
  ON public.product_sync_status (product_id);

CREATE INDEX IF NOT EXISTS idx_product_sync_status_platform
  ON public.product_sync_status (instance_id, platform, last_synced_at);

COMMENT ON TABLE public.product_sync_status IS
  'Per-product, per-platform sync state. UI compares last_synced_at against the '
  'product''s effective updated_at (max of product/variant/pricing updated_at) '
  'to derive the synced/pending status badge.';

COMMENT ON COLUMN public.product_sync_status.external_id IS
  'Cached id assigned by the external platform (e.g. WooCommerce product id). '
  'Algolia does not use this — its objectID is the variant SKU.';

COMMENT ON COLUMN public.product_sync_status.last_payload_hash IS
  'Hash of the last pushed payload. Future optimisation: skip pushes when '
  'the recomputed payload hash matches this value (no actual change).';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_sync_status_set_updated_at ON public.product_sync_status;
CREATE TRIGGER product_sync_status_set_updated_at
  BEFORE UPDATE ON public.product_sync_status
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS — same pattern as other catalog tables: read scoped to caller's instances
ALTER TABLE public.product_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_sync_status_select ON public.product_sync_status;
CREATE POLICY product_sync_status_select
  ON public.product_sync_status
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- Writes go through server actions using the service-role client; no policies
-- for INSERT/UPDATE/DELETE because authenticated users never write here directly.

-- ─── sync_log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sync_log (
  id                  bigserial PRIMARY KEY,
  instance_id         bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('algolia', 'woocommerce')),

  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz NULL,

  products_count      integer NOT NULL DEFAULT 0,
  succeeded_count     integer NOT NULL DEFAULT 0,
  failed_count        integer NOT NULL DEFAULT 0,

  status              text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'success', 'partial', 'error')),
  error_message       text NULL,

  -- Who triggered the sync (NULL for system/cron)
  triggered_by        uuid NULL,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_instance_started
  ON public.sync_log (instance_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_log_instance_platform_started
  ON public.sync_log (instance_id, platform, started_at DESC);

COMMENT ON TABLE public.sync_log IS
  'Append-only history of sync runs. The Sync Manager Historial panel reads '
  'the most recent rows for the user''s instance.';

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_log_select ON public.sync_log;
CREATE POLICY sync_log_select
  ON public.sync_log
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
  '20260506000001',
  'Sync Manager: product_sync_status + sync_log tables for Algolia/WooCommerce push tracking'
);
