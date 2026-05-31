-- category_sync_status: per-category, per-platform sync state.
--
-- Mirrors product_sync_status. The catalog → WooCommerce push needs to
-- map each RRE category to the WC numeric category id so products can
-- be sent with categories: [{ id: <wcId> }] (WC's REST API silently
-- ignores name-only category entries — name → no assignment).
--
-- external_id stores the WC category id for the (instance, category)
-- pair so subsequent pushes never re-create categories. Algolia doesn't
-- have categories as a concept here so platform is currently always
-- 'woocommerce', but the column is kept generic for symmetry with
-- product_sync_status.

CREATE TABLE IF NOT EXISTS public.category_sync_status (
  id                  bigserial PRIMARY KEY,
  instance_id         bigint NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  category_id         bigint NOT NULL REFERENCES public.category(category_id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('algolia', 'woocommerce')),

  last_synced_at      timestamptz NULL,
  last_status         text NULL CHECK (last_status IN ('success', 'error', 'skipped') OR last_status IS NULL),
  last_error          text NULL,

  -- Cached external id (e.g. WC category id) so the next push doesn't
  -- look up or recreate.
  external_id         text NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (instance_id, category_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_category_sync_status_instance
  ON public.category_sync_status (instance_id);

CREATE INDEX IF NOT EXISTS idx_category_sync_status_category
  ON public.category_sync_status (category_id);

CREATE INDEX IF NOT EXISTS idx_category_sync_status_platform
  ON public.category_sync_status (instance_id, platform, last_synced_at);

COMMENT ON TABLE public.category_sync_status IS
  'Per-category, per-platform sync state. Used by the WooCommerce push to '
  'map RRE category_id → WC category id (external_id) so products can be '
  'sent with categories: [{ id }] rather than name-only (which WC ignores).';

COMMENT ON COLUMN public.category_sync_status.external_id IS
  'Cached id assigned by the external platform (e.g. WooCommerce category id).';

DROP TRIGGER IF EXISTS category_sync_status_set_updated_at ON public.category_sync_status;
CREATE TRIGGER category_sync_status_set_updated_at
  BEFORE UPDATE ON public.category_sync_status
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.category_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS category_sync_status_select ON public.category_sync_status;
CREATE POLICY category_sync_status_select
  ON public.category_sync_status
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- Writes go through server actions using the service-role client; no
-- INSERT/UPDATE/DELETE policies for authenticated.

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260509000005',
  'category_sync_status table: caches WC category ids so product sync can attach categories: [{ id }]'
);
