-- Drop applies_to_variants from product_attribute.
-- Variant-axis is a per-category-link property (category_product_attribute.is_variant_axis),
-- not an attribute-level property. This column is no longer read by application code.
ALTER TABLE public.product_attribute DROP COLUMN IF EXISTS applies_to_variants;

-- Ensure dimension column exists (idempotent — was added in migration 000005).
ALTER TABLE public.product_attribute
  ADD COLUMN IF NOT EXISTS dimension text
  CHECK (dimension IN ('mass', 'volume', 'count') OR dimension IS NULL);

COMMENT ON COLUMN public.product_attribute.dimension IS
  'For data_type=quantity attributes only: mass, volume, or count. Filters which units of measure are valid. NULL for non-quantity attributes.';

-- Backfill content attribute dimension.
UPDATE public.product_attribute
SET dimension = 'mass'
WHERE attribute_code = 'content'
  AND data_type = 'quantity'
  AND dimension IS NULL;

-- Invariant checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_attribute'
      AND column_name = 'dimension'
  ) THEN
    RAISE EXCEPTION 'Invariant failed: dimension column not present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_attribute'
      AND column_name = 'applies_to_variants'
  ) THEN
    RAISE EXCEPTION 'Invariant failed: applies_to_variants column still present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_attribute
    WHERE attribute_code = 'content'
      AND dimension = 'mass'
  ) THEN
    RAISE EXCEPTION 'Invariant failed: content attribute should have dimension=mass';
  END IF;
END $$;
