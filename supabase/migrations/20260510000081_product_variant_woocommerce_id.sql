-- Add woocommerce_id to product_variant.
--
-- Captured during RRE→WC push (writeback of the variation post id WC
-- returns), or by a future variant-restructuring pass over wc_raw.variations
-- on imported products. The Meilisearch document builder uses this so the
-- storefront plugin can build add-to-cart URLs against WC's variation IDs
-- (not RRE's variant_id).
--
-- Partial unique on (instance_id, woocommerce_id) — a variation post id is
-- unique inside a WooCommerce site (which is one RRE instance), and we
-- allow many variants with woocommerce_id = NULL ("not yet round-tripped").

alter table public.product_variant
  add column if not exists woocommerce_id bigint;

create unique index if not exists uq_product_variant_woocommerce_id
  on public.product_variant (instance_id, woocommerce_id)
  where woocommerce_id is not null;

comment on column public.product_variant.woocommerce_id is
  'WC variation post ID. Captured during RRE→WC push or future variant restructuring of WC-imported wc_raw.variations. Used by the plugin to build add-to-cart URLs.';
