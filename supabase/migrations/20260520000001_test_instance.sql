-- Dedicated test instance for the integration test suite under
-- tests/integration/**.
--
-- instance_id = 99999 is intentionally far above any plausible real customer
-- id. The row is permanent (not torn down per test run) so that:
--   1. Tests don't race on instance setup vs. /api/v1/search request handling.
--   2. The associated query_log / failed_indexing rows stay queryable for
--      diagnostics when a test fails in CI.
--
-- storefront_domains = ['test.local'] is the Origin every integration test
-- sets on its synthetic request. The route's origin check resolves that host
-- against this array, so without this row the suite gets uniform 403s.

-- Parent tenant. The instance_sync_kind_from_tenant() trigger requires a
-- non-NULL tenant_id on every instance row, and the FK is enforced.
INSERT INTO public.tenant (tenant_id, name, slug, kind)
VALUES (99999, 'Integration tests (synthetic)', 'integration-tests', 'customer')
ON CONFLICT (tenant_id) DO UPDATE
  SET name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      kind = EXCLUDED.kind;

-- The actual test instance. slug is NOT NULL with no default — must be
-- explicit. Locale / currency / sku_config / billing_config / pricing_config
-- all have safe defaults so we don't pin synthetic values.
INSERT INTO public.instance (
  instance_id,
  name,
  slug,
  is_active,
  kind,
  storefront_domains,
  integrations_config,
  tenant_id
) VALUES (
  99999,
  'Integration tests (synthetic)',
  'integration-tests',
  true,
  'customer',
  ARRAY['test.local'],
  '{}'::jsonb,
  99999
)
ON CONFLICT (instance_id) DO UPDATE
  SET name               = EXCLUDED.name,
      slug               = EXCLUDED.slug,
      is_active          = EXCLUDED.is_active,
      storefront_domains = EXCLUDED.storefront_domains,
      tenant_id          = EXCLUDED.tenant_id;

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260520000001',
  'Search integration tests: reserve instance_id=99999 with storefront_domains=[test.local]'
)
ON CONFLICT (version) DO NOTHING;
