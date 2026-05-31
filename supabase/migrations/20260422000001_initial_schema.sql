-- ============================================================================
-- RRE Phase 1 — Initial schema
-- ============================================================================
--
-- Purpose: Create the complete RRE catalog management database structure,
-- designed to support multi-tenancy, multi-language content (via translation
-- tables), copy-on-signup templates, and eventual integrations with Medusa,
-- WooCommerce, Shopify, and Algolia.
--
-- Scope: Layer 1 (catalog management core) only. Layers 2-6 (enrichment,
-- agentic readiness, ecommerce push, Algolia push, feedback loop) come later.
--
-- Migration philosophy:
--   • Every tenant-scoped table has tenant_id, enforced by RLS
--   • Translatable text lives in separate _translation tables, not JSONB
--   • BCP 47 locale codes (e.g. es-GT, en-US)
--   • Primary-locale value lives in the base table, translations overlay it
--   • template_ref_id on templateable rows for future template versioning
--
-- Reference: /docs/inventory.md, /docs/decisions.md
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2. TENANT INFRASTRUCTURE
-- ============================================================================

CREATE TABLE tenant (
  tenant_id          bigserial PRIMARY KEY,
  name               text NOT NULL,
  slug               text NOT NULL UNIQUE,
  plan               text NOT NULL DEFAULT 'free'
                     CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  is_active          boolean NOT NULL DEFAULT true,
  primary_locale     text NOT NULL DEFAULT 'es-GT',
  supported_locales  text[] NOT NULL DEFAULT ARRAY['es-GT'],
  default_currency   text NOT NULL DEFAULT 'GTQ',
  integrations_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant IS 'Each row is one RRE customer workspace. All tenant-scoped tables FK to this.';
COMMENT ON COLUMN tenant.integrations_config IS 'JSON holding Algolia, Medusa, WooCommerce, Shopify API credentials per tenant.';
COMMENT ON COLUMN tenant.primary_locale IS 'BCP 47 format. Base table values are authored in this locale.';
COMMENT ON COLUMN tenant.supported_locales IS 'Array of BCP 47 codes the tenant has enabled. Must include primary_locale.';

CREATE INDEX idx_tenant_slug ON tenant(slug);
CREATE INDEX idx_tenant_active ON tenant(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. REFERENCE / LOOKUP TABLES
-- ============================================================================
-- These are tenant-scoped but often copy-on-signup from templates.
-- Every tenant has their own species list, breed list, attribute list, etc.

CREATE TABLE species (
  species_id         bigserial PRIMARY KEY,
  tenant_id          bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id   bigint NULL,
  name               text NOT NULL,
  plural_name        text NULL,
  slug               text NOT NULL,
  commercial_group   text NULL,
  description        text NULL,
  icon_key           text NULL,
  default_banner_key text NULL,
  menu_order         integer NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_species_tenant ON species(tenant_id);

CREATE TABLE species_profile (
  species_profile_id bigserial PRIMARY KEY,
  tenant_id          bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  species_id         bigint NOT NULL REFERENCES species(species_id) ON DELETE CASCADE,
  plural_name        text NULL,
  species_slug       text NULL,
  store_title        text NULL,
  store_subtitle     text NULL,
  default_banner_key text NULL,
  icon_key           text NULL,
  suggested_hex_color text NULL,
  uses_size_filter       boolean NOT NULL DEFAULT false,
  uses_life_stage_filter boolean NOT NULL DEFAULT false,
  uses_habitat_filter    boolean NOT NULL DEFAULT false,
  uses_water_type_filter boolean NOT NULL DEFAULT false,
  uses_coat_filter       boolean NOT NULL DEFAULT false,
  uses_activity_filter   boolean NOT NULL DEFAULT false,
  operational_note   text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, species_id)
);

CREATE INDEX idx_species_profile_tenant ON species_profile(tenant_id);

CREATE TABLE breed (
  breed_id         bigserial PRIMARY KEY,
  tenant_id        bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id bigint NULL,
  species_id       bigint NOT NULL REFERENCES species(species_id) ON DELETE CASCADE,
  breed_code       text NULL,
  breed_name       text NOT NULL,
  value_type       text NULL,
  normalized_name  text NULL,
  sort_order       integer NULL,
  is_active        boolean NOT NULL DEFAULT true,
  note             text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_breed_tenant ON breed(tenant_id);
CREATE INDEX idx_breed_species ON breed(species_id);

CREATE TABLE brand (
  brand_id    bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  brand_name  text NOT NULL,
  wazudb1_id  uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_tenant ON brand(tenant_id);

CREATE TABLE commercial_tag (
  tag_id       bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id bigint NULL,
  tag_code     text NOT NULL,
  tag_name     text NOT NULL,
  tag_type     text NULL CHECK (tag_type IN ('Campaña', 'Merchandising', 'Operación') OR tag_type IS NULL),
  is_temporary boolean NOT NULL DEFAULT false,
  description  text NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tag_code)
);

CREATE INDEX idx_commercial_tag_tenant ON commercial_tag(tenant_id);

-- ============================================================================
-- 4. PRODUCT TYPE (NEW — replaces product.product_type text column)
-- ============================================================================

CREATE TABLE product_type (
  product_type_id bigserial PRIMARY KEY,
  tenant_id       bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id bigint NULL,
  type_code       text NOT NULL,
  type_name       text NOT NULL,
  kind            text NOT NULL DEFAULT 'product'
                  CHECK (kind IN ('product', 'service')),
  description     text NULL,
  has_variants    boolean NOT NULL DEFAULT true,
  track_inventory_default boolean NOT NULL DEFAULT true,
  can_be_composite boolean NOT NULL DEFAULT false,
  consumes_supplies boolean NOT NULL DEFAULT false,
  sort_order      integer NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type_code)
);

CREATE INDEX idx_product_type_tenant ON product_type(tenant_id);

-- ============================================================================
-- 5. CATEGORY + SPECIES BRIDGE
-- ============================================================================

CREATE TABLE category (
  category_id        bigserial PRIMARY KEY,
  tenant_id          bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id   bigint NULL,
  parent_category_id bigint NULL REFERENCES category(category_id) ON DELETE SET NULL,
  category_code      text NULL,
  category_name      text NOT NULL,
  slug               text NOT NULL,
  description        text NULL,
  level              integer NOT NULL CHECK (level IN (1, 2)),
  sort_order         integer NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_category_tenant ON category(tenant_id);
CREATE INDEX idx_category_parent ON category(parent_category_id);

CREATE TABLE category_species (
  category_species_id  bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id     bigint NULL,
  category_id          bigint NOT NULL REFERENCES category(category_id) ON DELETE CASCADE,
  species_id           bigint NOT NULL REFERENCES species(species_id) ON DELETE CASCADE,
  active_for_species   boolean NOT NULL DEFAULT true,
  show_in_species_menu boolean NULL,
  show_in_header       boolean NULL,
  navigation_title     text NULL,
  header_title         text NULL,
  banner_key           text NULL,
  visual_order         integer NULL,
  note                 text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category_id, species_id)
);

CREATE INDEX idx_category_species_tenant ON category_species(tenant_id);
CREATE INDEX idx_category_species_category ON category_species(category_id);
CREATE INDEX idx_category_species_species ON category_species(species_id);

-- ============================================================================
-- 6. PRODUCT ATTRIBUTES
-- ============================================================================

CREATE TABLE product_attribute (
  attribute_id     bigserial PRIMARY KEY,
  tenant_id        bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id bigint NULL,
  attribute_code   text NOT NULL,
  attribute_name   text NOT NULL,
  description      text NULL,
  data_type        text NULL,
  is_multivalue    boolean NOT NULL DEFAULT false,
  is_filterable    boolean NOT NULL DEFAULT false,
  is_searchable    boolean NOT NULL DEFAULT false,
  used_in_pet_matching boolean NOT NULL DEFAULT false,
  applies_to_variants boolean NOT NULL DEFAULT false,
  suggested_unit   text NULL,
  example          text NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, attribute_code)
);

CREATE INDEX idx_product_attribute_tenant ON product_attribute(tenant_id);

CREATE TABLE product_attribute_option (
  value_id     bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id bigint NULL,
  attribute_id bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  value_code   text NULL,
  value        text NOT NULL,
  sort_order   integer NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_attribute_option_tenant ON product_attribute_option(tenant_id);
CREATE INDEX idx_product_attribute_option_attribute ON product_attribute_option(attribute_id);

-- Category × Attribute bridge
CREATE TABLE category_product_attribute (
  mapping_id        bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  category_id       bigint NOT NULL REFERENCES category(category_id) ON DELETE CASCADE,
  attribute_id      bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  requirement_level text NULL CHECK (requirement_level IN ('required', 'optional', 'hidden') OR requirement_level IS NULL),
  visible_in_filter        boolean NULL,
  visible_in_product_page  boolean NULL,
  form_order        integer NULL,
  note              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category_id, attribute_id)
);

CREATE INDEX idx_category_product_attribute_tenant ON category_product_attribute(tenant_id);

-- Product Type × Attribute bridge (NEW)
CREATE TABLE product_type_attribute (
  mapping_id        bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_type_id   bigint NOT NULL REFERENCES product_type(product_type_id) ON DELETE CASCADE,
  attribute_id      bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  is_required       boolean NOT NULL DEFAULT false,
  visible_in_form   boolean NOT NULL DEFAULT true,
  form_order        integer NULL,
  note              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_type_id, attribute_id)
);

CREATE INDEX idx_product_type_attribute_tenant ON product_type_attribute(tenant_id);

-- ============================================================================
-- 7. PRODUCT + VARIANT CORE
-- ============================================================================

CREATE TABLE product (
  product_id        bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_name      text NOT NULL,
  slug              text NOT NULL,
  product_type_id   bigint NOT NULL REFERENCES product_type(product_type_id) ON DELETE RESTRICT,
  brand_id          bigint NULL REFERENCES brand(brand_id) ON DELETE SET NULL,
  short_description text NULL,
  long_description  text NULL,
  manufacturer      text NULL,
  is_consignment    boolean NOT NULL DEFAULT false,
  track_inventory   boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  image_url         text NULL,
  wazudb1_id        uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_product_tenant ON product(tenant_id);
CREATE INDEX idx_product_brand ON product(brand_id);
CREATE INDEX idx_product_type ON product(product_type_id);
CREATE INDEX idx_product_active ON product(is_active) WHERE is_active = true;

CREATE TABLE product_variant (
  variant_id        bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id        bigint NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  variant_name      text NULL,
  variant_label     text NULL,
  sku               text NULL,
  barcode           text NULL,
  upc               text NULL,
  weight_grams      numeric NULL,
  pack_unit         numeric NULL,
  is_active         boolean NOT NULL DEFAULT true,
  is_pack           boolean NOT NULL DEFAULT false,
  inv_rotation_type text NULL CHECK (inv_rotation_type IN ('A', 'B', 'C') OR inv_rotation_type IS NULL),
  image_url         text NULL,
  wazudb1_id        uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX idx_product_variant_tenant ON product_variant(tenant_id);
CREATE INDEX idx_product_variant_product ON product_variant(product_id);
CREATE INDEX idx_product_variant_sku ON product_variant(sku);
CREATE INDEX idx_product_variant_barcode ON product_variant(barcode);

CREATE TABLE product_category_link (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES category(category_id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, category_id)
);

CREATE INDEX idx_product_category_link_tenant ON product_category_link(tenant_id);
CREATE INDEX idx_product_category_link_product ON product_category_link(product_id);
CREATE INDEX idx_product_category_link_category ON product_category_link(category_id);

CREATE TABLE product_tag_link (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  tag_id     bigint NOT NULL REFERENCES commercial_tag(tag_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, tag_id)
);

CREATE INDEX idx_product_tag_link_tenant ON product_tag_link(tenant_id);
CREATE INDEX idx_product_tag_link_product ON product_tag_link(product_id);

CREATE TABLE product_attribute_value (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id   bigint NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  attribute_id bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  value_id     bigint NULL REFERENCES product_attribute_option(value_id) ON DELETE SET NULL,
  value_text   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, attribute_id)
);

CREATE INDEX idx_product_attribute_value_tenant ON product_attribute_value(tenant_id);
CREATE INDEX idx_product_attribute_value_product ON product_attribute_value(product_id);

CREATE TABLE product_variant_attribute (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  variant_id   bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  attribute_id bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  value_id     bigint NULL REFERENCES product_attribute_option(value_id) ON DELETE SET NULL,
  value_text   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, variant_id, attribute_id)
);

CREATE INDEX idx_product_variant_attribute_tenant ON product_variant_attribute(tenant_id);
CREATE INDEX idx_product_variant_attribute_variant ON product_variant_attribute(variant_id);

-- ============================================================================
-- 8. PRODUCT MEDIA
-- ============================================================================

CREATE TABLE product_media (
  media_id    bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id  bigint NULL REFERENCES product(product_id) ON DELETE CASCADE,
  variant_id  bigint NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  image_url   text NOT NULL,
  alt_text    text NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL)
);

CREATE INDEX idx_product_media_tenant ON product_media(tenant_id);
CREATE INDEX idx_product_media_product ON product_media(product_id);
CREATE INDEX idx_product_media_variant ON product_media(variant_id);

-- ============================================================================
-- 9. PRICING (retail + online only for Phase 1)
-- ============================================================================

CREATE TABLE product_pricing (
  pricing_id     bigserial PRIMARY KEY,
  tenant_id      bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  variant_id     bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  channel        text NOT NULL DEFAULT 'retail'
                 CHECK (channel IN ('retail', 'online')),
  currency       text NOT NULL DEFAULT 'GTQ',
  list_price     numeric NOT NULL,
  cost_price     numeric NULL,
  sale_price     numeric NULL,
  sale_starts_at timestamptz NULL,
  sale_ends_at   timestamptz NULL,
  min_quantity   integer NOT NULL DEFAULT 1,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, variant_id, channel, min_quantity)
);

CREATE INDEX idx_product_pricing_tenant ON product_pricing(tenant_id);
CREATE INDEX idx_product_pricing_variant ON product_pricing(variant_id);

-- ============================================================================
-- 10. SERVICE COMPOSITION (NEW)
-- ============================================================================

CREATE TABLE service_component (
  component_id     bigserial PRIMARY KEY,
  tenant_id        bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  parent_variant_id bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  child_variant_id  bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE RESTRICT,
  quantity         numeric NOT NULL DEFAULT 1,
  is_optional      boolean NOT NULL DEFAULT false,
  sort_order       integer NULL,
  note             text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, parent_variant_id, child_variant_id),
  CHECK (parent_variant_id <> child_variant_id)
);

CREATE INDEX idx_service_component_tenant ON service_component(tenant_id);
CREATE INDEX idx_service_component_parent ON service_component(parent_variant_id);

COMMENT ON TABLE service_component IS 'A composite service (like Grooming Completo) is composed of atomic services (like Baño M, Corte de uñas). This bridges them.';

CREATE TABLE service_supply_recipe (
  recipe_id         bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  service_variant_id bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  supply_variant_id bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE RESTRICT,
  quantity          numeric NOT NULL,
  unit              text NULL,
  is_required       boolean NOT NULL DEFAULT true,
  note              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_variant_id, supply_variant_id),
  CHECK (service_variant_id <> supply_variant_id)
);

CREATE INDEX idx_service_supply_recipe_tenant ON service_supply_recipe(tenant_id);
CREATE INDEX idx_service_supply_recipe_service ON service_supply_recipe(service_variant_id);

COMMENT ON TABLE service_supply_recipe IS 'A service (like Baño M) consumes supplies (shampoo, towels). This drives inventory deduction when the service is performed.';

-- ============================================================================
-- 11. SERVICE PACKS (NEW)
-- ============================================================================

CREATE TABLE service_pack (
  pack_id               bigserial PRIMARY KEY,
  tenant_id             bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  pack_variant_id       bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  redeemable_variant_id bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE RESTRICT,
  redemption_count      integer NOT NULL CHECK (redemption_count > 0),
  valid_days            integer NOT NULL CHECK (valid_days > 0),
  note                  text NULL,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pack_variant_id)
);

CREATE INDEX idx_service_pack_tenant ON service_pack(tenant_id);

COMMENT ON TABLE service_pack IS 'Definition of a prepaid service pack (e.g. "5 bathings for Q320"). Sold once, redeemed multiple times over N days.';

CREATE TABLE service_pack_purchase (
  purchase_id       bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  pack_id           bigint NOT NULL REFERENCES service_pack(pack_id) ON DELETE RESTRICT,
  customer_ref      text NULL,  -- FK to customer table (external, not in Phase 1)
  purchased_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  initial_credits   integer NOT NULL CHECK (initial_credits > 0),
  remaining_credits integer NOT NULL CHECK (remaining_credits >= 0),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'depleted', 'cancelled')),
  note              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_credits <= initial_credits)
);

CREATE INDEX idx_service_pack_purchase_tenant ON service_pack_purchase(tenant_id);
CREATE INDEX idx_service_pack_purchase_pack ON service_pack_purchase(pack_id);
CREATE INDEX idx_service_pack_purchase_customer ON service_pack_purchase(customer_ref);
CREATE INDEX idx_service_pack_purchase_expires ON service_pack_purchase(expires_at);

CREATE TABLE service_pack_redemption (
  redemption_id bigserial PRIMARY KEY,
  tenant_id     bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  purchase_id   bigint NOT NULL REFERENCES service_pack_purchase(purchase_id) ON DELETE CASCADE,
  redeemed_at   timestamptz NOT NULL DEFAULT now(),
  note          text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_pack_redemption_tenant ON service_pack_redemption(tenant_id);
CREATE INDEX idx_service_pack_redemption_purchase ON service_pack_redemption(purchase_id);

-- ============================================================================
-- 12. PET PROFILE ATTRIBUTES + MATCHING RULES
-- ============================================================================

CREATE TABLE pet_profile_attribute (
  profile_attribute_id bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id     bigint NULL,
  attribute_code       text NOT NULL,
  attribute_name       text NOT NULL,
  description          text NULL,
  data_type            text NULL,
  is_multivalue        boolean NOT NULL DEFAULT false,
  visible_to_customer  boolean NOT NULL DEFAULT true,
  base_required        boolean NOT NULL DEFAULT false,
  used_in_matching     boolean NOT NULL DEFAULT false,
  suggested_unit       text NULL,
  example              text NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, attribute_code)
);

CREATE INDEX idx_pet_profile_attribute_tenant ON pet_profile_attribute(tenant_id);

CREATE TABLE pet_profile_attribute_option (
  value_id             bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id     bigint NULL,
  profile_attribute_id bigint NOT NULL REFERENCES pet_profile_attribute(profile_attribute_id) ON DELETE CASCADE,
  value_code           text NULL,
  value                text NOT NULL,
  sort_order           integer NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pet_profile_attribute_option_tenant ON pet_profile_attribute_option(tenant_id);
CREATE INDEX idx_pet_profile_attribute_option_attribute ON pet_profile_attribute_option(profile_attribute_id);

CREATE TABLE species_pet_profile_attribute (
  id                   bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  species_id           bigint NOT NULL REFERENCES species(species_id) ON DELETE CASCADE,
  profile_attribute_id bigint NOT NULL REFERENCES pet_profile_attribute(profile_attribute_id) ON DELETE CASCADE,
  applies              boolean NOT NULL DEFAULT true,
  required             boolean NOT NULL DEFAULT false,
  visible_in_onboarding boolean NOT NULL DEFAULT true,
  visible_in_edit      boolean NOT NULL DEFAULT true,
  form_order           integer NULL,
  note                 text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, species_id, profile_attribute_id)
);

CREATE INDEX idx_species_pet_profile_attribute_tenant ON species_pet_profile_attribute(tenant_id);

CREATE TABLE pet_product_matching_rule (
  mapping_id           bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  template_ref_id     bigint NULL,
  profile_attribute_id bigint NOT NULL REFERENCES pet_profile_attribute(profile_attribute_id) ON DELETE CASCADE,
  product_attribute_id bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  match_type           text NULL,
  priority             text NULL CHECK (priority IN ('Crítica', 'Alta', 'Media', 'Baja') OR priority IS NULL),
  note                 text NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, profile_attribute_id, product_attribute_id)
);

CREATE INDEX idx_pet_product_matching_rule_tenant ON pet_product_matching_rule(tenant_id);

-- ============================================================================
-- 13. TRANSLATION TABLES
-- ============================================================================
-- Pattern: one _translation table per translatable entity.
-- Primary-locale values live in the base table. Translation rows are overlays.
-- Locale codes are BCP 47 format (es-GT, en-US, pt-BR, etc.).

CREATE TABLE product_translation (
  id                bigserial PRIMARY KEY,
  tenant_id         bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_id        bigint NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  locale            text NOT NULL,
  product_name      text NULL,
  short_description text NULL,
  long_description  text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, locale)
);
CREATE INDEX idx_product_translation_tenant ON product_translation(tenant_id);
CREATE INDEX idx_product_translation_product_locale ON product_translation(product_id, locale);

CREATE TABLE product_variant_translation (
  id            bigserial PRIMARY KEY,
  tenant_id     bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  variant_id    bigint NOT NULL REFERENCES product_variant(variant_id) ON DELETE CASCADE,
  locale        text NOT NULL,
  variant_name  text NULL,
  variant_label text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, variant_id, locale)
);
CREATE INDEX idx_product_variant_translation_tenant ON product_variant_translation(tenant_id);

CREATE TABLE category_translation (
  id            bigserial PRIMARY KEY,
  tenant_id     bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  category_id   bigint NOT NULL REFERENCES category(category_id) ON DELETE CASCADE,
  locale        text NOT NULL,
  category_name text NULL,
  description   text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category_id, locale)
);
CREATE INDEX idx_category_translation_tenant ON category_translation(tenant_id);

CREATE TABLE category_species_translation (
  id                  bigserial PRIMARY KEY,
  tenant_id           bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  category_species_id bigint NOT NULL REFERENCES category_species(category_species_id) ON DELETE CASCADE,
  locale              text NOT NULL,
  navigation_title    text NULL,
  header_title        text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category_species_id, locale)
);
CREATE INDEX idx_category_species_translation_tenant ON category_species_translation(tenant_id);

CREATE TABLE species_translation (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  species_id  bigint NOT NULL REFERENCES species(species_id) ON DELETE CASCADE,
  locale      text NOT NULL,
  name        text NULL,
  plural_name text NULL,
  description text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, species_id, locale)
);
CREATE INDEX idx_species_translation_tenant ON species_translation(tenant_id);

CREATE TABLE species_profile_translation (
  id                 bigserial PRIMARY KEY,
  tenant_id          bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  species_profile_id bigint NOT NULL REFERENCES species_profile(species_profile_id) ON DELETE CASCADE,
  locale             text NOT NULL,
  plural_name        text NULL,
  store_title        text NULL,
  store_subtitle     text NULL,
  operational_note   text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, species_profile_id, locale)
);
CREATE INDEX idx_species_profile_translation_tenant ON species_profile_translation(tenant_id);

CREATE TABLE breed_translation (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  breed_id   bigint NOT NULL REFERENCES breed(breed_id) ON DELETE CASCADE,
  locale     text NOT NULL,
  breed_name text NULL,
  note       text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, breed_id, locale)
);
CREATE INDEX idx_breed_translation_tenant ON breed_translation(tenant_id);

CREATE TABLE commercial_tag_translation (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  tag_id      bigint NOT NULL REFERENCES commercial_tag(tag_id) ON DELETE CASCADE,
  locale      text NOT NULL,
  tag_name    text NULL,
  description text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tag_id, locale)
);
CREATE INDEX idx_commercial_tag_translation_tenant ON commercial_tag_translation(tenant_id);

CREATE TABLE product_type_translation (
  id              bigserial PRIMARY KEY,
  tenant_id       bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  product_type_id bigint NOT NULL REFERENCES product_type(product_type_id) ON DELETE CASCADE,
  locale          text NOT NULL,
  type_name       text NULL,
  description     text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_type_id, locale)
);
CREATE INDEX idx_product_type_translation_tenant ON product_type_translation(tenant_id);

CREATE TABLE product_attribute_translation (
  id              bigserial PRIMARY KEY,
  tenant_id       bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  attribute_id    bigint NOT NULL REFERENCES product_attribute(attribute_id) ON DELETE CASCADE,
  locale          text NOT NULL,
  attribute_name  text NULL,
  description     text NULL,
  example         text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, attribute_id, locale)
);
CREATE INDEX idx_product_attribute_translation_tenant ON product_attribute_translation(tenant_id);

CREATE TABLE product_attribute_option_translation (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  value_id   bigint NOT NULL REFERENCES product_attribute_option(value_id) ON DELETE CASCADE,
  locale     text NOT NULL,
  value      text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, value_id, locale)
);
CREATE INDEX idx_product_attribute_option_translation_tenant ON product_attribute_option_translation(tenant_id);

CREATE TABLE pet_profile_attribute_translation (
  id                   bigserial PRIMARY KEY,
  tenant_id            bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  profile_attribute_id bigint NOT NULL REFERENCES pet_profile_attribute(profile_attribute_id) ON DELETE CASCADE,
  locale               text NOT NULL,
  attribute_name       text NULL,
  description          text NULL,
  example              text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, profile_attribute_id, locale)
);
CREATE INDEX idx_pet_profile_attribute_translation_tenant ON pet_profile_attribute_translation(tenant_id);

CREATE TABLE pet_profile_attribute_option_translation (
  id         bigserial PRIMARY KEY,
  tenant_id  bigint NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  value_id   bigint NOT NULL REFERENCES pet_profile_attribute_option(value_id) ON DELETE CASCADE,
  locale     text NOT NULL,
  value      text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, value_id, locale)
);
CREATE INDEX idx_pet_profile_attribute_option_translation_tenant ON pet_profile_attribute_option_translation(tenant_id);

-- ============================================================================
-- 14. UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to every table that has an updated_at column
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tenant', 'species', 'species_profile', 'breed', 'brand', 'commercial_tag',
    'product_type', 'category', 'category_species',
    'product_attribute', 'product_attribute_option',
    'category_product_attribute', 'product_type_attribute',
    'product', 'product_variant',
    'product_attribute_value', 'product_variant_attribute',
    'product_media', 'product_pricing',
    'service_component', 'service_supply_recipe',
    'service_pack', 'service_pack_purchase',
    'pet_profile_attribute', 'pet_profile_attribute_option',
    'species_pet_profile_attribute', 'pet_product_matching_rule',
    'product_translation', 'product_variant_translation',
    'category_translation', 'category_species_translation',
    'species_translation', 'species_profile_translation',
    'breed_translation', 'commercial_tag_translation',
    'product_type_translation',
    'product_attribute_translation', 'product_attribute_option_translation',
    'pet_profile_attribute_translation', 'pet_profile_attribute_option_translation'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================================
-- 15. ROW-LEVEL SECURITY POLICIES
-- ============================================================================
--
-- Pattern: each tenant-scoped table has RLS enabled. Every SELECT/INSERT/UPDATE/DELETE
-- requires that tenant_id matches the current session's tenant claim.
--
-- The JWT custom claim 'tenant_id' is set by the auth layer when a user logs in.
-- Service role bypasses RLS (for backend jobs and admin operations).
--
-- For Phase 1, we enable RLS on all tables but leave policy enforcement
-- to be configured at the app layer. Policies will be tightened as auth
-- integration comes online.
-- ============================================================================

DO $$
DECLARE
  t text;
  all_tenant_tables text[] := ARRAY[
    'species', 'species_profile', 'breed', 'brand', 'commercial_tag',
    'product_type', 'category', 'category_species',
    'product_attribute', 'product_attribute_option',
    'category_product_attribute', 'product_type_attribute',
    'product', 'product_variant',
    'product_category_link', 'product_tag_link',
    'product_attribute_value', 'product_variant_attribute',
    'product_media', 'product_pricing',
    'service_component', 'service_supply_recipe',
    'service_pack', 'service_pack_purchase', 'service_pack_redemption',
    'pet_profile_attribute', 'pet_profile_attribute_option',
    'species_pet_profile_attribute', 'pet_product_matching_rule',
    'product_translation', 'product_variant_translation',
    'category_translation', 'category_species_translation',
    'species_translation', 'species_profile_translation',
    'breed_translation', 'commercial_tag_translation',
    'product_type_translation',
    'product_attribute_translation', 'product_attribute_option_translation',
    'pet_profile_attribute_translation', 'pet_profile_attribute_option_translation'
  ];
BEGIN
  FOREACH t IN ARRAY all_tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Enable RLS on tenant table separately (different policy structure)
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;

-- Note: policies are not created in this migration. They will be added in
-- a subsequent migration once the auth strategy is finalized (Supabase Auth
-- with JWT custom claims for tenant_id is the planned approach).
-- For Phase 1 development, we'll use the service role which bypasses RLS.

-- ============================================================================
-- 16. SCHEMA VERSION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS scout_schema_version (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text
);

INSERT INTO scout_schema_version (version, description) VALUES
  ('20260422000001', 'Initial RRE Phase 1 schema: multi-tenant catalog with translation tables');

-- ============================================================================
-- DONE
-- ============================================================================
--
-- Next steps (separate migrations):
--   20260422000002_pet_shop_template_seed.sql — seed pet-shop template data
--   20260422000003_wazu_tenant_provision.sql  — create tenant_id=1 for Wazú
--   20260422000004_wazu_data_import.sql       — import from petshopsys
--   20260422000005_rls_policies.sql           — tighten RLS with auth claims
--
-- ============================================================================
