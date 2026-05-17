# GroLabs — Schema (current state)

**Regenerated:** 2026-05-17
**Source commit:** `2f200e2` (HEAD of branch `claude/strange-gates-28d046`)
**Method:** inspection of `supabase/migrations/` (39 migration files, `20260422000001` … `20260514000001`). No live-DB query was run this pass. Where migration DDL and the live database diverge, **the live DB wins** (Constitution Article 10); the prior live-DB-generated snapshot corroborates the rename note below.

> Supersedes the 2026-04-30 @ `b43157a` snapshot, which predated the tenant layer.

---

## Critical rename caveat (read first)

The initial migration (`20260422000001_initial_schema.sql`) created the org table as **`tenant`** with PK/FK column **`tenant_id`**, and every tenant-scoped table FKs `tenant_id`. That table was later **renamed `tenant` → `instance`** and the column **`tenant_id` → `instance_id`** (CLAUDE.md §2: `instance_id` everywhere; `tenant_id` only survives in the initial migration text and legacy join tables). The original `tenant_member` was likewise renamed to **`instance_member`**; `20260514000001` renamed its dependent indexes/sequence off the old `tenant_member_*` names.

Then, on **2026-05-13/14**, a genuinely new **`tenant`** and **`tenant_member`** layer was added *above* `instance` (different tables, not the renamed originals).

So the current live schema has **four identity tables**: `tenant`, `tenant_member`, `instance`, `instance_member`. The tenancy/RLS boundary column is **`instance_id`**, not `tenant_id`. (The Task-5 instruction's phrase "the `tenant_id` column on every tenant-scoped table" is inconsistent with the actual repo convention — flagged; documented here as `instance_id`.)

---

## Identity domain (current, post-rename)

### `tenant` (new layer, `20260513000001_add_tenant_layer.sql`)
| Column | Type | Notes |
|---|---|---|
| `tenant_id` | bigserial | PK |
| `name` | text | NOT NULL |
| `slug` | text | NOT NULL UNIQUE |
| `kind` | text | NOT NULL, CHECK in (`template_owner`, `customer`) |
| `created_at` / `updated_at` | timestamptz | default now() |

Seed: GroLabs (`template_owner`) owns instance 0; Wazú (`customer`) owns instances 1 and 3. RLS: SELECT for authenticated users with membership in an owned instance; INSERT/UPDATE/DELETE service_role only.

### `tenant_member` (new, `20260514000001_add_tenant_member.sql`)
| Column | Type | Notes |
|---|---|---|
| `tenant_member_id` | bigserial | PK |
| `tenant_id` | bigint | NOT NULL, FK → `tenant(tenant_id)` ON DELETE CASCADE |
| `user_id` | uuid | NOT NULL (→ `auth.users`) |
| `role` | text | NOT NULL default `member`, CHECK in (`owner`,`admin`,`billing`,`member`) |
| `is_active` | boolean | NOT NULL default true |
| `created_at` / `updated_at` | timestamptz | default now() |

Trigger `trg_enforce_tenant_member_before_instance_member` (BEFORE INSERT on `instance_member`) requires a matching active `tenant_member` row. RLS: SELECT own rows only; writes service_role only. Backfill: 3 rows (GroLabs:1, Wazú:2).

### `instance` (renamed from original `tenant`)
| Column | Type | Notes |
|---|---|---|
| `instance_id` | bigserial | PK (sequence still named `tenant_tenant_id_seq` — naming debt) |
| `name` | text | NOT NULL |
| `slug` | text | NOT NULL UNIQUE |
| `plan` | text | default `free`, CHECK in (`free`,`starter`,`pro`,`enterprise`) |
| `is_active` | boolean | default true |
| `primary_locale` | text | default `es-GT` |
| `supported_locales` | text[] | default `{es-GT}` |
| `default_currency` | text | default `GTQ` |
| `integrations_config` | jsonb | default `{}` (algolia / woocommerce / ga4 / meilisearch keys) |
| `billing_config` | jsonb | default `{}` |
| `kind` | text | `customer` / `template`; **deprecated**, trigger-synced from `tenant.kind` (`20260513000001`) |
| `tenant_id` | bigint | FK → `tenant(tenant_id)`; NOT NULL after backfill (`20260513000001`) |
| `sku_config` | jsonb | added `20260425000010` |
| `storefront_domains` | text[] | added `20260509000005_instance_storefront_domains` |
| `created_at` / `updated_at` | timestamptz | default now() |

### `instance_member` (renamed from original `tenant_member`)
| Column | Type | Notes |
|---|---|---|
| `member_id` | bigserial | PK (sequence renamed to `instance_member_member_id_seq` in `20260514000001`) |
| `instance_id` | bigint | FK → `instance` |
| `user_id` | uuid | → `auth.users` |
| `role` | text | default `owner` (free-text, no CHECK yet) |
| `is_active` | boolean | |
| `is_current` | boolean | NOT NULL default false; partial unique index `(user_id) WHERE is_current` (`20260510000010`) |
| `created_at` / `updated_at` | timestamptz | |

---

## Table inventory by domain

All tables below are **`instance_id`-scoped** with `instance_isolation_*` RLS unless noted. Per-column fidelity for non-identity tables is summarized from migration DDL; the live DB / migration files remain authoritative for exact column lists.

**system/shared:** `tenant`, `tenant_member`, `instance`, `instance_member`, `scout_schema_version` (RLS disabled — sole exception), `unit_of_measure` (shared, `public` SELECT; 8 seeded units), `search_rate_limit`.

**taxonomy (per-instance):** `species`, `species_translation`, `species_profile`, `species_profile_translation`, `species_pet_profile_attribute`, `breed`, `breed_translation`, `pet_profile_attribute`, `pet_profile_attribute_option`, `pet_profile_attribute_translation`, `pet_profile_attribute_option_translation`, `pet_product_matching_rule`. *(Pet-profile family is vertical template data per Constitution Article 1; flagged for the pet-shop-schema-cleanup backlog item.)*

**catalog (per-instance):** `category`, `category_translation`, `category_species`, `category_species_translation`, `category_product_attribute` (carries `is_variant_axis`), `product` (+ `woocommerce_id`, `wc_raw` jsonb from `20260509000007_wc_import_columns`), `product_translation`, `product_variant` (+ `woocommerce_id` from `20260510000081`), `product_variant_attribute`, `product_variant_translation`, `product_attribute` (+ `dimension`, `parsing hint`), `product_attribute_option`, `product_attribute_translation`, `product_attribute_option_translation`, `product_attribute_value`, `product_category_link`, `product_pricing`, `product_media`, `product_relationship`, `product_tag_link`, `product_type`, `product_type_attribute`, `product_type_translation`, `brand` (+ `manufacturer` from `20260430000005`), `commercial_tag`, `commercial_tag_translation`.

**imports (per-instance):** `import_job`, `import_staging`, `catalog_suggestion`.

**services (per-instance, no UI):** `service_component`, `service_pack`, `service_pack_purchase`, `service_pack_redemption`, `service_supply_recipe`.

**pricing (per-instance; GroLabs-native — `20260508000002` + `20260509*` + `20260510000023`):** `provider`, `provider_brand`, `price_list`, `price_list_item` (+ `suggested_price`), `map_rule`, `price_batch` (+ syncing state), `price_batch_item`, `charm_rule` (+ `ends_in_whole`), pricing config on `instance.integrations_config`. *(Native pricing engine — consistent with Constitution Article 9; contradicts the superseded `docs/design/pricing/*` WP-plugin framing.)*

**sync / search status:** `product_sync_status`, `sync_log`, `category_sync_status`, `failed_indexing`, `query_log` (Meilisearch — `20260510000001_meilisearch_sync_status_and_log`).

**search:** `instance.storefront_domains`, `search_rate_limit`; index config is per-instance Meilisearch (`inst_<instance_id>`), not a Postgres table.

**analytics — GA4 (`20260510000020`–`22`):** `ga4_session_daily`, `ga4_traffic_daily`, `ga4_page_daily`, `ga4_geo_daily`, `ga4_device_daily` (each PK includes `instance_id` + `date` + dimensions), `ga4_alert` (lifecycle `firing → acknowledged → cleared`). GA4 OAuth refresh token in Supabase Vault; config in `instance.integrations_config.ga4`.

**funnel (`20260430000001`–`04`):** shared — `funnel_flow`, `funnel_stage`, `funnel_transition`, `funnel_friction_point` (`shared_read_all_authenticated` + `shared_write_service_role_only`); per-instance — `funnel_instance`, `funnel_dataset`, `funnel_dataset_transition_value`, `funnel_benchmark_source`, `funnel_friction_finding` (`tenant_read` with `instance_id = 0` template fallthrough + `tenant_write_all`). Several per-instance funnel tables derive `instance_id` via BEFORE INSERT/UPDATE triggers from the parent `funnel_instance`. Templates: jewelry / clothing / electronics (industry-agnostic — correct per Article 1).

## RLS pattern legend (unchanged)

- `instance_isolation_*` (catalog/legacy): 4 policies, authenticated members of the row's `instance_id`; templates (`instance_id = 0`) visible only via `service_role`.
- `tenant_read` + `tenant_write_all` (funnel per-instance): SELECT allows `instance_id = 0` OR membership; writes membership only.
- `shared_read_all_authenticated` + `shared_write_service_role_only` (funnel shared).
- `tenant` / `tenant_member`: SELECT scoped (membership / self); writes service_role only.
- Every table except `scout_schema_version` has RLS enabled.
