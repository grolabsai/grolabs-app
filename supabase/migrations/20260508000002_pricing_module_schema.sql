-- Pricing module — provider-based costs, MAP rules, change batches.
-- Maps the ERD in design_handoff_pricing_module/ERD.html onto Scout conventions:
-- bigserial IDs, instance_id everywhere, instance_isolation_* RLS via current_instance_id().

-- ============================================================================
-- 1. CATEGORY MARGIN FIELDS
-- ============================================================================

ALTER TABLE category
  ADD COLUMN IF NOT EXISTS target_margin numeric(5,2),
  ADD COLUMN IF NOT EXISTS min_margin    numeric(5,2);

-- ============================================================================
-- 2. PROVIDER
-- ============================================================================

CREATE TABLE provider (
  provider_id    bigserial PRIMARY KEY,
  instance_id    bigint NOT NULL REFERENCES instance(instance_id),
  provider_name  text NOT NULL,
  contact_info   jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_terms  text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_instance ON provider(instance_id);
CREATE UNIQUE INDEX uq_provider_instance_name ON provider(instance_id, provider_name);

CREATE TRIGGER trg_provider_updated
  BEFORE UPDATE ON provider
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. PROVIDER ↔ BRAND (many-to-many)
-- ============================================================================

CREATE TABLE provider_brand (
  instance_id  bigint NOT NULL REFERENCES instance(instance_id),
  provider_id  bigint NOT NULL REFERENCES provider(provider_id) ON DELETE CASCADE,
  brand_id     bigint NOT NULL REFERENCES brand(brand_id)       ON DELETE CASCADE,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, brand_id)
);

CREATE INDEX idx_provider_brand_instance ON provider_brand(instance_id);
CREATE INDEX idx_provider_brand_brand    ON provider_brand(brand_id);

-- ============================================================================
-- 4. PRICE LIST (one import from a provider)
-- ============================================================================

CREATE TABLE price_list (
  price_list_id        bigserial PRIMARY KEY,
  instance_id          bigint NOT NULL REFERENCES instance(instance_id),
  provider_id          bigint NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  import_date          timestamptz NOT NULL DEFAULT now(),
  effective_date       date,
  file_name            text,
  imported_by_user_id  uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_list_instance ON price_list(instance_id);
CREATE INDEX idx_price_list_provider ON price_list(provider_id);
CREATE INDEX idx_price_list_import   ON price_list(instance_id, import_date DESC);

-- ============================================================================
-- 5. PRICE LIST ITEM (one cost row per variant in a price list)
-- ============================================================================

CREATE TABLE price_list_item (
  price_list_item_id  bigserial PRIMARY KEY,
  instance_id         bigint  NOT NULL REFERENCES instance(instance_id),
  price_list_id       bigint  NOT NULL REFERENCES price_list(price_list_id)         ON DELETE CASCADE,
  variant_id          bigint  NOT NULL REFERENCES product_variant(variant_id)       ON DELETE CASCADE,
  cost                numeric(12,2) NOT NULL CHECK (cost >= 0),
  provider_sku        text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_list_item_instance ON price_list_item(instance_id);
CREATE INDEX idx_price_list_item_list     ON price_list_item(price_list_id);
CREATE INDEX idx_price_list_item_variant  ON price_list_item(variant_id);
CREATE UNIQUE INDEX uq_price_list_item_list_variant ON price_list_item(price_list_id, variant_id);

-- ============================================================================
-- 6. MAP RULE (polymorphic: source = brand or provider)
-- ============================================================================

CREATE TABLE map_rule (
  map_rule_id     bigserial PRIMARY KEY,
  instance_id     bigint  NOT NULL REFERENCES instance(instance_id),
  rule_type       text    NOT NULL CHECK (rule_type IN ('MAP_min','max_price','custom')),
  source_type     text    NOT NULL CHECK (source_type IN ('brand','provider')),
  source_id       bigint  NOT NULL,                                      -- FK enforced by app/trigger (polymorphic)
  variant_id      bigint  REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  min_price       numeric(12,2) CHECK (min_price IS NULL OR min_price >= 0),
  max_price       numeric(12,2) CHECK (max_price IS NULL OR max_price >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  effective_date  date    NOT NULL DEFAULT current_date,
  expires_at      date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (min_price IS NOT NULL OR max_price IS NOT NULL),
  CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price)
);

CREATE INDEX idx_map_rule_instance       ON map_rule(instance_id);
CREATE INDEX idx_map_rule_source         ON map_rule(source_type, source_id);
CREATE INDEX idx_map_rule_variant        ON map_rule(variant_id);
CREATE INDEX idx_map_rule_active_lookup  ON map_rule(instance_id, is_active) WHERE is_active = true;

CREATE TRIGGER trg_map_rule_updated
  BEFORE UPDATE ON map_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 7. PRICE BATCH (worksheet of pending price changes)
-- ============================================================================

CREATE TABLE price_batch (
  price_batch_id      bigserial PRIMARY KEY,
  instance_id         bigint  NOT NULL REFERENCES instance(instance_id),
  batch_name          text    NOT NULL,
  status              text    NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','ready','synced')),
  created_by_user_id  uuid    REFERENCES auth.users(id),
  synced_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_batch_instance ON price_batch(instance_id);
CREATE INDEX idx_price_batch_status   ON price_batch(instance_id, status);

CREATE TRIGGER trg_price_batch_updated
  BEFORE UPDATE ON price_batch
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 8. PRICE BATCH ITEM
-- ============================================================================

CREATE TABLE price_batch_item (
  price_batch_item_id  bigserial PRIMARY KEY,
  instance_id          bigint  NOT NULL REFERENCES instance(instance_id),
  price_batch_id       bigint  NOT NULL REFERENCES price_batch(price_batch_id)   ON DELETE CASCADE,
  variant_id           bigint  NOT NULL REFERENCES product_variant(variant_id)   ON DELETE CASCADE,
  current_cost         numeric(12,2),
  new_cost             numeric(12,2),
  current_price        numeric(12,2),
  charm_price          numeric(12,2),
  final_price          numeric(12,2),
  manual_override      boolean NOT NULL DEFAULT false,
  margin_percent       numeric(7,2),
  status               text    NOT NULL DEFAULT 'neutral'
                               CHECK (status IN ('neutral','warning','critical')),
  status_reasons       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_batch_item_instance ON price_batch_item(instance_id);
CREATE INDEX idx_price_batch_item_batch    ON price_batch_item(price_batch_id);
CREATE INDEX idx_price_batch_item_variant  ON price_batch_item(variant_id);
CREATE UNIQUE INDEX uq_price_batch_item_batch_variant ON price_batch_item(price_batch_id, variant_id);

CREATE TRIGGER trg_price_batch_item_updated
  BEFORE UPDATE ON price_batch_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 9. ROW-LEVEL SECURITY
-- ============================================================================

DO $$
DECLARE
  t text;
  pricing_tables text[] := ARRAY[
    'provider', 'provider_brand',
    'price_list', 'price_list_item',
    'map_rule',
    'price_batch', 'price_batch_item'
  ];
BEGIN
  FOREACH t IN ARRAY pricing_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_select ON %1$I FOR SELECT TO authenticated
        USING (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_insert ON %1$I FOR INSERT TO authenticated
        WITH CHECK (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_update ON %1$I FOR UPDATE TO authenticated
        USING (instance_id = current_instance_id())
        WITH CHECK (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_delete ON %1$I FOR DELETE TO authenticated
        USING (instance_id = current_instance_id())
    $f$, t);
  END LOOP;
END $$;

-- ============================================================================
-- 10. SCHEMA VERSION
-- ============================================================================

INSERT INTO scout_schema_version (version, description)
VALUES ('20260508000002',
        'Pricing module: provider, provider_brand, price_list(_item), map_rule, price_batch(_item); category margin fields');
