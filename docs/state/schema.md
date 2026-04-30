# Scout — Schema (current state)

Generated 2026-04-30 against Supabase project `ixbbhwtpnebrhquunege`. One
section per table, ordered by domain. Reflects the live database — read
via `information_schema`, `pg_policies`, `pg_constraint`, `pg_indexes`,
and `pg_trigger`. Where the DB and the migration files diverge, the DB
wins.

**RLS pattern legend:**
- `instance_isolation_*` (catalog/legacy): four policies (SELECT / INSERT
  / UPDATE / DELETE) all restricted to authenticated members of the row's
  `instance_id`. Templates (`instance_id = 0`) are visible only via
  `service_role`.
- `tenant_read` + `tenant_write_all` (funnel per-tenant): SELECT allows
  `instance_id = 0` OR membership; INSERT/UPDATE/DELETE allow membership
  only.
- `shared_read_all_authenticated` + `shared_write_service_role_only`
  (funnel shared): authenticated SELECT all; only `service_role` writes.

Every table except `scout_schema_version` has RLS enabled. Most tables
also have a trivial `BEFORE UPDATE` trigger that bumps `updated_at` to
`now()`.

---

## Domain: system

### `instance`
**Tenancy:** system. **RLS:** `instance_isolation_*` (4 policies) +
`tenant_self_select` + `tenant_self_update`.

**Columns:** `instance_id` bigint PK (sequence still named
`tenant_tenant_id_seq` from before the rename), `name`, `slug`, `plan`
(default `'free'`), `is_active`, `primary_locale` (default `'es-GT'`),
`supported_locales` text[] (default `['es-GT']`), `default_currency`
(default `'GTQ'`), `integrations_config` jsonb, `billing_config` jsonb,
`kind` text default `'customer'` (also takes `'template'` for the
seed-template instance), `sku_config` jsonb (default
`{prefix:"", padding:5, next_number:1}`), `created_at`, `updated_at`.

**Relationships:** referenced by ~every other table via `instance_id`.
**Notable:** `trg_tenant_updated` BEFORE UPDATE.
**Seed source:** `supabase/migrations/20260422000001_initial_schema.sql`.

### `instance_member`
**Tenancy:** system. **RLS:** `instance_member_self_select` only — users
can read their own memberships. Inserts/updates/deletes happen via the
service-role admin path.

**Columns:** `member_id` PK, `instance_id` FK, `user_id` uuid (→
`auth.users`), `role` (default `'owner'`), `is_active`, timestamps.

**Seed source:** populated on signup; no migration seed.

### `scout_schema_version`
**Tenancy:** system. **RLS:** disabled (the only table where RLS is off).
**Columns:** `version`, `applied_at`, `description`. Tracks applied
migrations.

### `unit_of_measure`
**Tenancy:** shared (no `instance_id`). **RLS:** `uom_read_all` to
`public`; writes service-role only.

**Columns:** `unit_id` PK, `code`, `name`, `dimension` (mass/volume/count),
`to_si_factor` numeric, `si_base_unit`, `is_active`, `sort_order`,
timestamps.

**Notable:** the only table with a `public` SELECT policy. Eight rows
seeded (g / kg / oz / lb / ml / l / fl_oz / ea).
**Seed source:** `20260422000002_unit_of_measure.sql`.

---

## Domain: taxonomy

### `species`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `species_id` PK, `instance_id`, `template_ref_id`, `name`,
`plural_name`, `slug`, `commercial_group`, `description`, `icon_key`,
`default_banner_key`, `menu_order`, `is_active`, timestamps.
**Relationships:** FK `instance_id` → `instance`. Referenced by `breed`,
`category_species`, `species_pet_profile_attribute`, `species_profile`,
`species_translation`.

### `species_translation`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `species_id`, `locale`, `name`,
`plural_name`, `description`, timestamps.

### `species_profile`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `species_profile_id` PK, `instance_id`, `species_id`,
`plural_name`, `species_slug`, `store_title`, `store_subtitle`,
`default_banner_key`, `icon_key`, `suggested_hex_color`,
six `uses_*_filter` booleans (size/life_stage/habitat/water_type/coat/activity),
`operational_note`, timestamps.
**Note:** not currently surfaced in any UI.

### `species_profile_translation`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `species_profile_id`, `locale`,
`plural_name`, `store_title`, `store_subtitle`, `operational_note`.

### `species_pet_profile_attribute`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `species_id`, `profile_attribute_id`,
`applies`, `required`, `visible_in_onboarding`, `visible_in_edit`,
`form_order`, `note`, timestamps.

### `breed`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `breed_id` PK, `instance_id`, `template_ref_id`, `species_id`,
`breed_code`, `breed_name`, `value_type`, `normalized_name`, `sort_order`,
`is_active`, `note`, timestamps.

### `breed_translation`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `breed_id`, `locale`, `breed_name`,
`note`, timestamps.

### `pet_profile_attribute`, `pet_profile_attribute_option`,
`pet_profile_attribute_translation`,
`pet_profile_attribute_option_translation`,
`pet_product_matching_rule`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.

The pet-profile family mirrors the product-attribute family but for
buyer-pet profiles. `pet_profile_attribute` defines the schema (code,
name, data_type, multivalue, used_in_matching, etc.);
`pet_profile_attribute_option` holds enum values;
`pet_product_matching_rule` joins a profile attribute to a product
attribute via a `match_type`. Not surfaced in any UI on `main`.

---

## Domain: catalog

### `category`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `category_id` PK, `instance_id`, `template_ref_id`,
`parent_category_id` (self-FK), `category_code`, `category_name`, `slug`,
`description`, `level`, `sort_order`, `is_active`, `parsing_note`,
timestamps.
**Notable:** `default_variant_axes` was dropped in
`20260426000003_drop_default_variant_axes`. Variant axes now live on
`category_product_attribute.is_variant_axis` per CLAUDE.md §9.

### `category_translation`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `category_id`, `locale`,
`category_name`, `description`, timestamps.

### `category_species`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `category_species_id` PK, `instance_id`, `template_ref_id`,
`category_id`, `species_id`, `active_for_species`, `show_in_species_menu`,
`show_in_header`, `navigation_title`, `header_title`, `banner_key`,
`visual_order`, `note`, timestamps.

### `category_species_translation`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `id` PK, `instance_id`, `category_species_id`, `locale`,
`navigation_title`, `header_title`, timestamps.

### `category_product_attribute`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `mapping_id` PK, `instance_id`, `category_id`, `attribute_id`,
`requirement_level`, `visible_in_filter`, `visible_in_product_page`,
`form_order`, `note`, `is_variant_axis` (default `false`),
`variant_axis_order`, timestamps.
**Notable:** the join row carries the variant-axis flag — the same
`product_attribute` row can be a descriptive attribute on one category
and a variant axis on another.

### `product`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.
**Columns:** `product_id` PK, `instance_id`, `product_name`, `slug`,
`product_type_id` FK, `brand_id` FK (nullable),
`short_description`, `long_description`, `manufacturer` (nullable text —
free-form, not normalized; see modules.md "Manufacturer field" for the
debt note), `is_consignment`, `track_inventory`, `is_active`, `image_url`
(nullable, deprecated in favour of `product_media`), `wazudb1_id` (uuid,
legacy migration ref), timestamps.

### `product_translation`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`,
`product_id`, `locale`, `product_name`, `short_description`,
`long_description`, timestamps.

### `product_variant`
**Tenancy:** per-tenant. **Columns:** `variant_id` PK, `instance_id`,
`product_id`, `variant_name`, `variant_label`, `sku`, `barcode`, `upc`,
`weight_grams`, `pack_unit`, `is_active`, `is_pack`, `inv_rotation_type`,
`image_url`, `wazudb1_id`, timestamps.

### `product_variant_attribute`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `variant_id`,
`attribute_id` FK → `product_attribute`, `value_id` FK →
`product_attribute_option` (nullable), `value_text` (nullable),
`value_number` numeric (nullable), `unit_id` FK → `unit_of_measure`
(nullable), timestamps.
**Notable:** mirrors `product_attribute_value` but at the variant level —
this is what carries variant-axis values like "Color = red".

### `product_variant_translation`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `variant_id`,
`locale`, `variant_name`, `variant_label`, timestamps.

### `product_attribute`
**Tenancy:** per-tenant. **Columns:** `attribute_id` PK, `instance_id`,
`template_ref_id`, `attribute_code`, `attribute_name`, `description`,
`data_type`, `is_multivalue`, `is_filterable`, `is_searchable`,
`used_in_pet_matching`, `suggested_unit`, `dimension`, `example`,
`is_active`, timestamps.

### `product_attribute_option`
**Tenancy:** per-tenant. **Columns:** `value_id` PK, `instance_id`,
`template_ref_id`, `attribute_id`, `value_code`, `value`, `sort_order`,
`is_active`, timestamps.

### `product_attribute_translation`, `product_attribute_option_translation`
**Tenancy:** per-tenant. Translations of name / description / value per
locale; not surfaced in any UI on `main`.

### `product_attribute_value`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `product_id`,
`attribute_id`, `value_id` FK → `product_attribute_option` (nullable),
`value_text` (nullable), `value_number` numeric (nullable), `unit_id` FK →
`unit_of_measure` (nullable), timestamps.

### `product_category_link`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `product_id`,
`category_id`, `is_primary`, `created_at`. Many-to-many link with a
single-primary flag.

### `product_pricing`
**Tenancy:** per-tenant. **Columns:** `pricing_id` PK, `instance_id`,
`variant_id`, `channel` (default `'retail'`), `currency` (default
`'GTQ'`), `list_price` numeric, `cost_price` numeric (nullable),
`sale_price`, `sale_starts_at`, `sale_ends_at`, `min_quantity` (default
`1`), `is_active`, timestamps.

### `product_media`
**Tenancy:** per-tenant. **Columns:** `media_id` PK, `instance_id`,
`product_id` (nullable), `variant_id` (nullable), `image_url`, `alt_text`,
`is_primary`, `sort_order`, timestamps.

### `product_relationship`
**Tenancy:** per-tenant. **Columns:** `relationship_id` PK, `instance_id`,
`template_ref_id`, `source_product_id`, `target_product_id`,
`relation_type`, `is_required`, `display_order`, `note`, timestamps.
**Notable:** the FK constraints are composite on `(instance_id,
source_product_id)` and `(instance_id, target_product_id)` — same-instance
invariant enforced in DDL.

### `product_tag_link`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `product_id`,
`tag_id` FK → `commercial_tag`, `created_at`.

### `product_type`
**Tenancy:** per-tenant. **Columns:** `product_type_id` PK, `instance_id`,
`template_ref_id`, `type_code`, `type_name`, `kind` (default
`'product'`; takes `'service_basic'`, `'service_pack'`, etc.),
`description`, `has_variants`, `track_inventory_default`,
`can_be_composite`, `consumes_supplies`, `sort_order`, `is_active`,
timestamps.

### `product_type_attribute`
**Tenancy:** per-tenant. **Columns:** `mapping_id` PK, `instance_id`,
`product_type_id`, `attribute_id`, `is_required`, `visible_in_form`,
`form_order`, `note`, timestamps.

### `product_type_translation`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`,
`product_type_id`, `locale`, `type_name`, `description`, timestamps.

### `brand`
**Tenancy:** per-tenant. **Columns:** `brand_id` PK, `instance_id`,
`brand_name`, `wazudb1_id`, timestamps. Six columns total — no
manufacturer link, no description, no logo.

### `commercial_tag`
**Tenancy:** per-tenant. **Columns:** `tag_id` PK, `instance_id`,
`template_ref_id`, `tag_code`, `tag_name`, `tag_type`, `is_temporary`,
`description`, `is_active`, timestamps.

### `commercial_tag_translation`
**Tenancy:** per-tenant. **Columns:** `id` PK, `instance_id`, `tag_id`,
`locale`, `tag_name`, `description`, timestamps.

---

## Domain: imports

### `import_job`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_import_job_*`.
**Columns:** `job_id` PK, `instance_id`, `source_type` (text — e.g.
`'text_paste'`, `'csv'`), `filename`, `raw_input`, `row_count`, `status`
(default `'pending'`), `column_mapping` jsonb, `target_category_id`,
`error_message`, `created_by` uuid, `created_at`, `updated_at`,
`completed_at`.

### `import_staging`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_import_staging_*`.
**Columns:** `staging_id` PK, `instance_id`, `job_id`, `row_number`,
`raw_data` jsonb, `normalized_data` jsonb, `status` (default `'pending'`),
`cluster_id`, `cluster_confidence`, `proposed_product_id`,
`proposed_variant_id`, `issues` jsonb, `created_at`.

### `catalog_suggestion`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_catalog_suggestion_*`.
**Columns:** `suggestion_id` PK, `instance_id`, `job_id`, `staging_id`,
`suggestion_type`, `source_function`, `entity_type`, `entity_id`,
`confidence` numeric, `payload` jsonb, `status` (default `'pending'`),
`reviewed_by` uuid, `reviewed_at`, `editor_notes`, `created_at`.

---

## Domain: services (no UI yet)

### `service_component`, `service_pack`, `service_pack_purchase`,
`service_pack_redemption`, `service_supply_recipe`
**Tenancy:** per-tenant. **RLS:** `instance_isolation_*`.

The services family is seeded but has no admin UI on `main`. Conceptually:
- `service_component` joins a parent service variant to child variants
  (e.g. a "grooming" service contains a "shampoo" supply).
- `service_supply_recipe` is the consumption rate.
- `service_pack` packages N redemptions of a redeemable variant for
  purchase as a single SKU.
- `service_pack_purchase` is a customer's purchased pack.
- `service_pack_redemption` records each redemption against a purchase.

All FK to `product_variant` (via `parent_variant_id`, `child_variant_id`,
`pack_variant_id`, `redeemable_variant_id`, `service_variant_id`,
`supply_variant_id`).

---

## Domain: funnel

All funnel tables ship from migration `20260430000001_funnel_schema.sql`,
seeded by `_seed.sql`, and the "Electrónica corta" template added in
`20260430000004_funnel_short_electronics_template.sql`.

Two RLS shapes coexist here, both newer than the `instance_isolation_*`
pattern:
- **Shared** (`funnel_flow`, `funnel_stage`, `funnel_transition`,
  `funnel_friction_point`): `shared_read_all_authenticated` (SELECT) +
  `shared_write_service_role_only` (ALL, service_role).
- **Per-tenant** (the other five): `tenant_read` (SELECT, allows
  `instance_id = 0` OR membership) + `tenant_write_all` (ALL, membership
  only — no template fallthrough).

### `funnel_flow`
**Tenancy:** shared. **Columns:** `funnel_flow_id` PK, `slug`, `name`,
`description`, timestamps.

### `funnel_stage`
**Tenancy:** shared. **Columns:** `funnel_stage_id` PK, `funnel_flow_id`,
`slug`, `label`, `stage_order`, `color`, `position_x`, `position_y`,
`icon_key` (lucide PascalCase), `is_terminal`, `is_dropoff`, timestamps.

### `funnel_transition`
**Tenancy:** shared. **Columns:** `funnel_transition_id` PK,
`funnel_flow_id`, `source_stage_id`, `target_stage_id`, `slug`,
`transition_type` enum, `is_active`, timestamps.
**Notable:** composite FKs on `(funnel_flow_id, source_stage_id)` and
`(funnel_flow_id, target_stage_id)` enforce the same-flow invariant in
DDL — no trigger needed.

### `funnel_friction_point`
**Tenancy:** shared. **Columns:** `funnel_friction_point_id` PK,
`funnel_stage_id`, `slug`, `name`, `description`, `category`, timestamps.

### `funnel_instance`
**Tenancy:** per-tenant. **Columns:** `funnel_instance_id` PK,
`instance_id`, `funnel_flow_id`, `slug`, `name`, `funnel_instance_type`
enum (`template`/`customer`/`scenario`), `industry`, `monthly_traffic`
(default `10000`), `average_order_value` (default `100`),
`average_cart_skus` (default `2`), timestamps.

### `funnel_dataset`
**Tenancy:** per-tenant. **Columns:** `funnel_dataset_id` PK,
`instance_id` (denormalised, trigger-derived from
`funnel_instance.instance_id`), `funnel_instance_id`, `funnel_flow_id`,
`slug`, `name`, `description`, `is_active`, timestamps.
**Notable:** trigger `funnel_dataset_set_instance_id_trg` BEFORE INSERT
OR UPDATE — copies `instance_id` from the parent `funnel_instance`. App
code MUST NOT pass `instance_id`.

### `funnel_dataset_transition_value`
**Tenancy:** per-tenant. **Columns:** `funnel_dataset_transition_value_id`
PK, `instance_id` (denorm, trigger-derived), `funnel_dataset_id`,
`funnel_transition_id`, `conversion_pct` numeric (CHECK 0–100),
`source_type` enum
(`benchmark`/`customer_actual`/`manual_estimate`/`api_extraction`),
`notes`, timestamps.
**Notable:** trigger `funnel_dataset_transition_value_set_instance_id_trg`
mirrors the dataset's pattern.

### `funnel_benchmark_source`
**Tenancy:** per-tenant. **Columns:** `funnel_benchmark_source_id` PK,
`instance_id` (denorm, trigger-derived), `funnel_dataset_transition_value_id`,
`title`, `url`, `source_name`, `notes`, `observed_value` numeric,
`confidence_score` numeric (CHECK 0–1), `created_at`.

### `funnel_friction_finding`
**Tenancy:** per-tenant. **Columns:** `funnel_friction_finding_id` PK,
`instance_id` (denorm, trigger-derived), `funnel_instance_id`,
`funnel_friction_point_id`, `slug`, `severity` enum
(`low`/`medium`/`high`/`critical`), `evidence`, `source_system`,
`observed_at` date, `source_payload` jsonb, `created_at`.
