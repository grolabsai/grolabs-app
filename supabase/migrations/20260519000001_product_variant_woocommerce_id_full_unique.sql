-- Make product_variant's (instance_id, woocommerce_id) uniqueness usable as
-- an upsert conflict target.
--
-- 20260510000081 created this index PARTIAL (WHERE woocommerce_id IS NOT
-- NULL). PostgREST's on_conflict only accepts a column list — it cannot
-- supply the index predicate — so a partial unique index can't be inferred
-- as an ON CONFLICT arbiter. The WC variations import upserts variant rows
-- on (instance_id, woocommerce_id); without a full unique index that upsert
-- fails with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- A plain (non-partial) unique index is equivalent for our invariant:
-- Postgres treats NULLs as distinct (NULLS DISTINCT, the PG15 default), so
-- many variants with woocommerce_id = NULL ("not yet round-tripped") are
-- still allowed, while non-null variation post ids stay unique per instance.
-- This mirrors product.uq_product_woocommerce_id, which is already full and
-- is upserted on the same way by the products import.

drop index if exists public.uq_product_variant_woocommerce_id;

create unique index if not exists uq_product_variant_woocommerce_id
  on public.product_variant (instance_id, woocommerce_id);

comment on column public.product_variant.woocommerce_id is
  'WC variation post ID. Set by the WC variations import or a Scout->WC push. Unique per instance when present; NULL until round-tripped. Used by the plugin to build add-to-cart URLs.';
