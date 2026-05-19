-- Backfill: every product gets at least one product_variant row.
--
-- Background: the GroLabs catalog model is variant-centric — sku/pricing/stock
-- live on product_variant + product_pricing. Historically several flows
-- (notably WC import v1, docs/policy/wc-import.md) created product rows
-- without variant rows, leaving 58 orphan products in the live DB that the
-- search indexer either skipped or had to special-case via parent-field
-- fallback. This migration creates one 1:1 default variant per orphan
-- product, mirroring the parent's sku/barcode/is_active, plus a retail
-- product_pricing row when the parent has a price.
--
-- Scope: every product where no product_variant exists. Not WC-specific —
-- if any other flow produces an orphan product in the future, the same
-- guarantee holds after the next deploy because the importer now creates
-- the default variant inline (see src/lib/import/woocommerce/pull-products.ts).
--
-- Variable WC products (wc_raw.type='variable') get the same placeholder
-- variant here. The future wc-import-variants restructure pass is expected
-- to detect a single placeholder variant (woocommerce_id IS NULL) on a
-- variable parent and replace it with real variants exploded from
-- wc_raw.variations[].
--
-- Idempotent: WHERE NOT EXISTS makes a re-run a no-op once every product
-- has at least one variant.

WITH inserted_variants AS (
  INSERT INTO product_variant (
    instance_id,
    product_id,
    sku,
    barcode,
    is_active
  )
  SELECT
    p.instance_id,
    p.product_id,
    p.sku,
    p.barcode,
    p.is_active
  FROM product p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variant pv WHERE pv.product_id = p.product_id
  )
  RETURNING variant_id, instance_id, product_id
)
INSERT INTO product_pricing (
  instance_id,
  variant_id,
  channel,
  currency,
  list_price,
  cost_price
)
SELECT
  iv.instance_id,
  iv.variant_id,
  'retail',
  COALESCE(inst.default_currency, 'GTQ'),
  p.price,
  p.cost
FROM inserted_variants iv
JOIN product p ON p.product_id = iv.product_id
LEFT JOIN instance inst ON inst.instance_id = iv.instance_id
WHERE p.price IS NOT NULL;
