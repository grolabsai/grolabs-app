-- Instance service model: what platform an instance runs on, which search
-- backend it uses, and which GroLabs services it has.
--
-- Purpose: model how a given implementation is shaped BEFORE any credentials
-- exist. Until now the only way to tell whether an instance "has" WooCommerce
-- or Algolia was to look for its credentials in integrations_config — which
-- conflates "configured" with "in scope". A merchant who has bought search but
-- hasn't connected it yet is a real state, and it needs to be representable.
--
-- These columns drive the left navigation: menu items appear or disappear per
-- instance based on them.
--
-- Column style: text + CHECK rather than Postgres enums. The lists here will
-- grow (BigCommerce, Magento, more services), and extending a CHECK constraint
-- is a one-line migration whereas ALTER TYPE ... ADD VALUE is more awkward to
-- reverse. This also matches the existing `plan` / `kind` columns.

-- ── Store platform ──────────────────────────────────────────────────────────
ALTER TABLE public.instance
  ADD COLUMN IF NOT EXISTS store_platform text NOT NULL DEFAULT 'proprietary';

ALTER TABLE public.instance
  DROP CONSTRAINT IF EXISTS instance_store_platform_check;
ALTER TABLE public.instance
  ADD CONSTRAINT instance_store_platform_check
  CHECK (store_platform IN ('shopify', 'woocommerce', 'medusa', 'proprietary'));

-- ── Search provider ─────────────────────────────────────────────────────────
-- 'meilisearch' is "through us" — GroLabs-owned index, full proxy + event
-- ownership. 'algolia' is merchant-owned, connected with their own keys.
ALTER TABLE public.instance
  ADD COLUMN IF NOT EXISTS search_provider text NOT NULL DEFAULT 'meilisearch';

ALTER TABLE public.instance
  DROP CONSTRAINT IF EXISTS instance_search_provider_check;
ALTER TABLE public.instance
  ADD CONSTRAINT instance_search_provider_check
  CHECK (search_provider IN ('algolia', 'meilisearch'));

-- ── Contracted services ─────────────────────────────────────────────────────
-- DEFAULT true on purpose: every existing instance currently sees every menu
-- item, and a default of false would silently empty everyone's navigation on
-- deploy. New instances start with everything on and get narrowed deliberately.
ALTER TABLE public.instance
  ADD COLUMN IF NOT EXISTS service_catalog   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_analytics boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_search    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_pricing   boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.instance.store_platform IS
  'Ecommerce platform this instance runs on. Drives which platform-specific configuration screens appear in the nav.';
COMMENT ON COLUMN public.instance.search_provider IS
  'Search backend: algolia (merchant-owned keys) or meilisearch (GroLabs-owned, "through us"). Decides which screen the Search nav item opens.';
COMMENT ON COLUMN public.instance.service_catalog IS
  'Contracted service flag — hides the Catalog nav group when false.';
COMMENT ON COLUMN public.instance.service_analytics IS
  'Contracted service flag — hides the Google Analytics configuration item when false.';
COMMENT ON COLUMN public.instance.service_search IS
  'Contracted service flag — hides the Search configuration item when false.';
COMMENT ON COLUMN public.instance.service_pricing IS
  'Contracted service flag — hides the Pricing nav group when false.';

-- ── Seed the instances we can state with confidence ─────────────────────────
-- Search provider is derived from what is actually configured today: an
-- instance holding Algolia credentials is demonstrably on Algolia.
UPDATE public.instance
SET search_provider = 'algolia'
WHERE integrations_config ? 'algolia';

-- Platform is NOT inferred — a Shopify storefront domain is suggestive, not
-- proof. Only the two we know for certain are set; everything else stays
-- 'proprietary' for a human to correct on /configuration/properties.
UPDATE public.instance SET store_platform = 'medusa'  WHERE instance_id = 11;  -- HPC
UPDATE public.instance SET store_platform = 'shopify' WHERE instance_id = 16;  -- Shopify Dev

INSERT INTO scout_schema_version (version, description)
VALUES ('20260801170000', 'Instance service model: store_platform, search_provider, and four contracted-service flags driving nav visibility');
