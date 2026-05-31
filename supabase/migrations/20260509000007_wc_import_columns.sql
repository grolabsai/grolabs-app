-- WooCommerce import (v1) — schema additions per docs/policy/wc-import.md.
--
-- One-way pull from WC into RRE's catalog tables. Idempotency key is
-- (instance_id, woocommerce_id). Variations are NOT exploded into
-- product_variant rows in v1 — the raw WC payload (including the
-- variations array) lands in product.wc_raw for a future restructure
-- process to consume.
--
-- RRE's product/variant/pricing model is variant-centric (sku, price,
-- stock live on product_variant + product_pricing). To preserve mapped
-- fields without creating shadow variant rows, we add the obvious
-- columns directly on product. The future wc-import-variants process
-- will migrate them onto variant/pricing rows.

-- ─── category ──────────────────────────────────────────────────────────────

alter table category add column if not exists woocommerce_id bigint;

-- NOTE: full (non-partial) unique index. Partial unique indexes are not
-- usable as ON CONFLICT arbiters by PostgREST/supabase-js. Postgres
-- treats NULLs as distinct in unique indexes, so non-imported rows
-- (woocommerce_id is null) coexist freely.
create unique index if not exists uq_category_woocommerce_id
  on category (instance_id, woocommerce_id);

comment on column category.woocommerce_id is
  'Stable identity for WC import (docs/policy/wc-import.md). NULL for non-imported rows.';

-- ─── product ───────────────────────────────────────────────────────────────

alter table product add column if not exists woocommerce_id bigint;
alter table product add column if not exists wc_raw jsonb not null default '{}'::jsonb;

-- Mapped WC fields. Live here as raw preservation; future variant
-- restructure migrates onto product_variant + product_pricing.
alter table product add column if not exists sku text;
alter table product add column if not exists barcode text;
alter table product add column if not exists price numeric;
alter table product add column if not exists sale_price numeric;
alter table product add column if not exists cost numeric;
alter table product add column if not exists stock_quantity integer;

-- product_type_id is NOT NULL in normal RRE flows, but WC has no
-- analog — imports leave it null, enrichment populates later.
alter table product alter column product_type_id drop not null;

create unique index if not exists uq_product_woocommerce_id
  on product (instance_id, woocommerce_id);

comment on column product.woocommerce_id is
  'Stable identity for WC import (docs/policy/wc-import.md). NULL for non-imported rows.';
comment on column product.wc_raw is
  'Lossless preservation of unmapped WC fields. Includes variations[] array on variable products and any meta_data RRE has no column for.';
comment on column product.sku is
  'WC-imported SKU. Lives on product (not product_variant) until wc-import-variants restructure runs.';
comment on column product.price is
  'WC regular_price snapshot at import. Authoritative pricing lives in product_pricing once a variant exists.';
