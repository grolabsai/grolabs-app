---
application: core-app
module: Policy
title: "GroLabs WooCommerce Import — v1"
status: Active
owner: "Tuncho"
scope: "One-way pull from WooCommerce into GroLabs's catalog tables. Categories and products only. Raw data preservation, no enrichment, no restructuring."
audience: "Claude Code (primary), future GroLabs contributors"

actors:
  - name: WooCommerce
    type: integration
    definition: The merchant's WooCommerce store; the read-only source of categories and products (WC REST API v3).
  - name: Import job
    type: system
    definition: The pull-direction importer at src/lib/import/woocommerce/ that upserts WC data into GroLabs catalog tables.
  - name: Merchant
    type: human
    definition: The instance owner who triggers category and product imports from /import/woocommerce.

users:
  - name: Merchant
    description: Connects WooCommerce credentials and runs "Importar categorías" / "Importar productos" from the admin UI.

integrations:
  - name: WooCommerce REST API
    kind: external-service
    target: woocommerce
    direction: in
    purpose: One-way pull of product_cat and products (GET /wp-json/wc/v3/...), paged 100 at a time, products filtered to status=publish.
  - name: src/lib/sync/
    kind: internal-module
    target: woocommerce
    direction: out
    purpose: The existing push-direction (GroLabs→WC) sync; unchanged by this pull-direction work and deliberately kept in a separate namespace.

credentials:
  - name: instance.integrations_config.woocommerce
    location: instance.integrations_config (configured via /configuration/woocommerce)
    scope: WooCommerce REST credentials reused by the importer

rules:
  - id: R-1
    statement: The import is a one-way pull — WC is the source, GroLabs writes and never pushes back from this code path.
    truth: true
  - id: R-2
    statement: The import is lossless — any WC field with no mapped GroLabs column is preserved in product.wc_raw (JSONB), never thrown away.
    truth: true
  - id: R-3
    statement: Re-runs are idempotent — (instance_id, woocommerce_id) is the upsert conflict key, so re-importing UPDATEs rather than INSERTs; no checkpoint table is needed.
    truth: true
  - id: R-4
    statement: Categories preserve hierarchy as-is — WC parent id maps to category.parent_id via a second-pass woocommerce_id lookup, with no merging into template categories.
    truth: true
  - id: R-5
    statement: WC variable products become exactly one GroLabs product row each; the variations array is kept in wc_raw and no product_variant rows are created during import.
    truth: true
  - id: R-6
    statement: No enrichment happens during import — scout_attributes stay null and are populated by a separate process.
    truth: true
  - id: R-7
    statement: Field mapping is obvious-only — only clear 1:1 fields get columns; when in doubt the field stays in wc_raw.
    truth: true
  - id: R-8
    statement: Composite uniqueness (instance_id, woocommerce_id) lets the same WC ID exist independently in different instances.
    truth: true
  - id: R-9
    statement: Each upsert is its own transaction, so a mid-run failure cannot corrupt the catalog and a re-run picks up where it left off.
    truth: true

useCases:
  - id: T-1
    title: Re-running the import produces no duplicates
    given: A catalog already imported once
    when: The import runs again
    then: Existing rows are updated in place with no duplicates
    verifies: [R-3]
  - id: T-2
    title: Variable products are stored, not exploded
    given: A WC variable product
    when: It is imported
    then: Exactly one GroLabs product row is created and wc_raw.variations holds all variations
    verifies: [R-5]
  - id: T-3
    title: Category hierarchy is reconstructed
    given: WC categories with parent relationships
    when: The categories pass and its second pass run
    then: All rows are present and parent_id is correctly set across the tree
    verifies: [R-4]
  - id: T-4
    title: Non-published products are skipped
    given: WC products whose status is not publish
    when: The products pass runs
    then: Those products are ignored
  - id: T-5
    title: Mid-import network failure does not corrupt data
    given: A network failure partway through a run
    when: The run aborts and is retried
    then: No partial corruption exists because each upsert is independent
    verifies: [R-9]
---

# GroLabs WooCommerce Import — v1

Status: Active policy
Owner: Tuncho
Scope: One-way pull from WooCommerce into GroLabs's catalog tables. Categories and products only. Raw data preservation, no enrichment, no restructuring.
Audience: Claude Code (primary), future GroLabs contributors

This document is the authoritative spec for the WooCommerce → GroLabs import. Read it before writing any code. Stop at the two `APPROVAL REQUIRED` checkpoints (§8 and §9) and wait for explicit approval.

## 1. Goals and non-goals

### Goal
Pull a merchant's existing WooCommerce catalog (categories + products) into GroLabs's `category` and `product` tables so GroLabs has the data. Re-runnable. Idempotent. **Lossless** — any source field we don't have a mapped GroLabs column for is preserved as JSONB for future processes to consume.

### Non-goals
- Enrichment (lifestage, species, breed, etc.) — separate process
- Variant restructuring (WC variations → GroLabs `product_variant` rows) — separate process
- Category similarity matching against GroLabs's template categories — separate process
- Attribute normalization (`product_attribute` ↔ WC attributes) — separate process
- Push back to WC (already exists in `src/lib/sync/`, this work doesn't touch it)
- Meilisearch indexing (Stage 1 of `search-foundations.md`, will consume what this produces)

## 2. Architectural decisions (locked)

If implementation surfaces a flaw, raise it as a question — don't work around it silently.

**One-way pull.** WC is the source. GroLabs writes; never pushes back from this code path. Push-direction sync lives in `src/lib/sync/` and is unchanged.

**Raw preservation.** Any WC field not mapped to a GroLabs column lands in `product.wc_raw` (JSONB). Future restructuring/enrichment processes read from this column. We never throw away source data.

**Idempotent re-runs.** `category.woocommerce_id` and `product.woocommerce_id` are unique-per-instance and used as the upsert conflict key. Re-importing the same record UPDATEs instead of INSERTing. No checkpoint table needed in v1 — interrupted runs are safe to re-run because already-imported records are matched by `woocommerce_id`.

**Categories preserve hierarchy as-is.** WC's `parent` (id) maps directly to GroLabs's `category.parent_id` via a second-pass lookup. No restructuring, no merging with GroLabs's template categories.

**Variations stored, not exploded.** WC variable products become **one** GroLabs `product` row each. The WC `variations` array is preserved in `wc_raw` for the future restructuring process. v1 does not create `product_variant` rows from imports.

**No enrichment during import.** `scout_attributes` (lifestage, species, breed_compatibility, etc.) stay null on imported records. A separate enrichment process populates them.

**Code lives at `src/lib/import/woocommerce/`.** NOT in `src/lib/sync/` — sync is push-direction (GroLabs→WC), this is pull-direction (WC→GroLabs). Different namespaces prevent debugging confusion.

**UI at `/import/woocommerce`.** Matches the existing `/import/text` and `/import/wizard` pattern. Reuses WC credentials already stored in `instance.integrations_config.woocommerce` via `/configuration/woocommerce`.

**Multi-tenancy boundary uses `instance_id`,** consistent with all other GroLabs tables. Composite uniqueness `(instance_id, woocommerce_id)` lets the same WC ID exist independently in different instances.

## 3. Schema additions

Three changes, applied via Supabase MCP, verified via `information_schema`.

```sql
-- Stable identity for re-import / future sync.
alter table category add column woocommerce_id bigint;
alter table product add column woocommerce_id bigint;

-- Lossless preservation of unmapped fields, including the variations array
-- on variable products and any meta_data GroLabs doesn't have a column for.
alter table product add column wc_raw jsonb not null default '{}'::jsonb;

-- Composite uniqueness — same WC ID can exist in different instances.
create unique index uq_category_woocommerce_id
  on category (instance_id, woocommerce_id) where woocommerce_id is not null;
create unique index uq_product_woocommerce_id
  on product (instance_id, woocommerce_id) where woocommerce_id is not null;
```

If `product` is missing any obvious columns (e.g. `barcode`, `cost`), add them in the same migration. When in doubt whether a field is "obvious enough" to deserve a column, leave it in `wc_raw`.

## 4. Field mapping

Only obvious 1:1 mappings get columns. Everything else → `wc_raw`.

### Category (WC `product_cat`)
| WC field | GroLabs column |
|---|---|
| `id` | `woocommerce_id` |
| `name` | `name` |
| `slug` | `slug` |
| `parent` (id) | `parent_id` (looked up via `woocommerce_id`, second pass after all categories inserted) |
| everything else | dropped (categories have no `wc_raw`) |

### Product
| WC field | GroLabs column |
|---|---|
| `id` | `woocommerce_id` |
| `name` | `name` |
| `slug` | `slug` |
| `sku` | `sku` |
| `description` | `description` |
| `short_description` | `short_description` |
| `price` | `price` |
| `sale_price` | `sale_price` |
| `stock_quantity` | `stock_quantity` |
| `images[0].src` | `featured_image_url` (or whatever GroLabs uses for primary image) |
| `categories[].id` | `product_category_link` rows (via `category.woocommerce_id` lookup) |
| `meta_data` entries for barcode / cost (key names vary by WC theme — common: `_barcode`, `_cost`, `_wc_cog_cost`) | `barcode`, `cost` if present |
| **everything else** including `variations`, `attributes`, all unmapped `meta_data` | `wc_raw` |

## 5. Pull algorithm

1. Verify WC credentials work: `GET /wp-json/wc/v3/products?per_page=1`. If 401/403/network error, abort with a clear UI message.
2. **Categories pass:**
   - Page through `GET /wp-json/wc/v3/products/categories?per_page=100&page=N` until empty.
   - For each: build the GroLabs row, `INSERT ... ON CONFLICT (instance_id, woocommerce_id) DO UPDATE`.
   - Second pass: re-walk all imported categories, set `parent_id` via `woocommerce_id` lookup.
3. **Products pass:**
   - Page through `GET /wp-json/wc/v3/products?per_page=100&page=N&status=publish` until empty.
   - For each: extract mapped fields, dump everything else into `wc_raw`.
   - `INSERT ... ON CONFLICT (instance_id, woocommerce_id) DO UPDATE`.
   - Refresh `product_category_link` rows from `categories[]` (delete-then-insert is fine — small per-product set).
4. Update `instance.integrations_config.woocommerce.last_import_at` and `last_import_summary` (counts + duration).

Each upsert is its own transaction. Mid-run failures don't corrupt anything; re-running picks up where it left off because already-imported records match on `woocommerce_id` and get UPDATEd as no-ops if unchanged.

## 6. Admin UI at `/import/woocommerce`

- **Connection status** at top — reuses the test from `/configuration/woocommerce`
- **Two buttons:** "Importar categorías" and "Importar productos" (disabled if WC not configured)
- **Progress display** while running: "Importando 234/1000 productos..."
- **Last-run summary:** counts, duration, timestamp
- **Error panel** below — show any per-record failures so the merchant can investigate

Both buttons are server actions; progress can be implemented with polling or a streaming response. Pick whatever's simplest given Next.js 15's RSC patterns — don't over-engineer.

## 7. Test cases

- Empty WC catalog → 0 categories, 0 products, no errors
- Categories import → all rows present, `parent_id` correctly set across the tree
- Products import → mapped fields populated, `wc_raw` contains everything else (including `variations` array)
- Re-run import → no duplicates, existing rows updated
- Variable product → exactly one GroLabs `product` row, `wc_raw.variations` has all variations
- Product with multiple categories → multiple `product_category_link` rows
- Product with no SKU → imports anyway, `sku` is null
- Network failure mid-import → no partial corruption (each upsert independent)
- WC credentials missing or invalid → UI buttons disabled with clear message
- WC products with `status` other than `publish` → ignored

## 8. APPROVAL REQUIRED — Checkpoint 1
Before writing code:
1. Confirm understanding of all decisions in this document.
2. Identify ambiguities or contradictions and ask clarifying questions.
3. Propose the file tree (migrations, lib code, admin page, server actions).
4. Wait for explicit approval before writing any code.

## 9. APPROVAL REQUIRED — Checkpoint 2
After code is written:
1. Run all test cases in §7 against the live Wazú WC instance (or a staging copy if available).
2. Report pass/fail with reasons for any failures.
3. Wait for explicit approval before merging to main.

## 10. Out of scope — handled by separate policies/processes later

- `wc-import-enrichment.md` — populates `scout_attributes` from WC data, LLM, or both
- `wc-import-variants.md` — explodes `wc_raw.variations` into `product_variant` + `product_variant_attribute` rows
- `wc-import-category-matching.md` — finds similarities between imported categories and GroLabs's template, offers a rename/apply UI
- `search-foundations.md` Stage 1 — indexes GroLabs's catalog into Meilisearch (consumes the data this policy produces)

## 11. Resolved decisions

These have been resolved through Tuncho's direction (2026-05-09):

1. **Bring categories in as-is.** No matching against template, no restructuring during import. Future process handles similarity detection.
2. **Don't enhance data during import.** Enrichment is a separate process that runs after.
3. **Variants: store the raw WC structure, restructure later.** No `product_variant` rows created during import.
4. **Field mapping is "obvious-only."** When in doubt, leave it in `wc_raw`.
