---
application: core-app
module: State
title: "GroLabs — Schema (current state)"
status: Draft
audience: "Contributors and assistants who need the current database shape — identity tables, the instance_id tenancy boundary, table inventory by domain, and RLS patterns."
scope: "Point-in-time schema snapshot (2026-05-17, commit 2f200e2) derived from 39 migration files. Time-sensitive; where migration DDL and the live DB diverge, the live DB wins (Constitution Article 10)."
actors:
  - name: tenant
    type: system
    definition: "New identity layer (20260513000001) above instance: tenant_id PK, slug unique, kind in (template_owner, customer). RLS: SELECT for members of an owned instance; writes service_role only."
  - name: tenant_member
    type: system
    definition: "New membership table (20260514000001) linking user_id to tenant with role (owner/admin/billing/member). A trigger requires a matching active tenant_member before any instance_member insert."
  - name: instance
    type: system
    definition: "The org table renamed from the original tenant; instance_id PK is the tenancy/RLS boundary. Holds plan, locales, currency, integrations_config, storefront_domains; kind is deprecated and trigger-synced from tenant.kind."
  - name: instance_member
    type: system
    definition: "Membership renamed from the original tenant_member; member_id PK, role free-text (no CHECK yet), is_current with a partial unique index (user_id) WHERE is_current."
integrations:
  - name: Supabase Vault
    kind: external-service
    target: "GA4 OAuth refresh token"
    direction: in
    purpose: "Stores the GA4 OAuth refresh token referenced by analytics config (instance.integrations_config.ga4); a credential reference, not a column."
  - name: Meilisearch index
    kind: external-service
    target: "inst_<instance_id> per-instance index"
    direction: both
    purpose: "Search index config lives in Meilisearch, not a Postgres table; query_log and search_rate_limit are the only Postgres-side search tables."
rules:
  - id: R-1
    statement: "The tenancy/RLS boundary column is instance_id, not tenant_id; tenant_id survives only in the initial migration text and legacy join tables (CLAUDE.md §2)."
    truth: true
    rationale: "Critical rename caveat section."
  - id: R-2
    statement: "The original 'tenant'/'tenant_member' tables were renamed to instance/instance_member; then a genuinely new tenant/tenant_member layer was added above instance — so the live schema has four distinct identity tables."
    truth: true
    rationale: "Critical rename caveat: four identity tables (tenant, tenant_member, instance, instance_member)."
  - id: R-3
    statement: "All non-identity tables are instance_id-scoped with instance_isolation_* RLS unless noted; templates (instance_id = 0) are visible only via service_role."
    truth: true
    rationale: "Table inventory intro and RLS pattern legend."
  - id: R-4
    statement: "Every table has RLS enabled except scout_schema_version, the sole exception."
    truth: true
    rationale: "RLS pattern legend final bullet and system/shared listing."
  - id: R-5
    statement: "Funnel per-instance tables use tenant_read (SELECT allows instance_id = 0 OR membership) + tenant_write_all, and several derive instance_id via BEFORE INSERT/UPDATE triggers from the parent funnel_instance; funnel shared tables use shared_read_all_authenticated + shared_write_service_role_only."
    truth: true
    rationale: "Funnel domain row and RLS pattern legend."
  - id: R-6
    statement: "Pricing is GroLabs-native (provider, price_list, charm_rule, etc.) consistent with Constitution Article 9, contradicting the superseded docs/design/pricing/* WP-plugin framing."
    truth: true
    rationale: "Pricing domain note."
  - id: R-7
    statement: "The instance sequence is still named tenant_tenant_id_seq (pre-rename naming debt); instance.kind is deprecated-not-dropped and kept in sync with tenant.kind by trigger."
    truth: true
    rationale: "instance table notes (instance_id and kind rows)."
useCases:
  - id: T-1
    title: "Resolve the tenant_id vs instance_id confusion"
    given: "A contributor reads 'the tenant_id column on every tenant-scoped table' in an old instruction"
    when: "They consult the rename caveat"
    then: "They learn the actual boundary column is instance_id and tenant_id only persists in legacy text, avoiding a wrong RLS assumption"
    verifies: [R-1, R-2]
  - id: T-2
    title: "Enforce tenant membership before instance membership"
    given: "A new instance_member row is being inserted"
    when: "The BEFORE INSERT trigger trg_enforce_tenant_member_before_instance_member fires"
    then: "The insert is rejected unless a matching active tenant_member row exists, keeping the two identity layers consistent"
    verifies: [R-2]
---

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
