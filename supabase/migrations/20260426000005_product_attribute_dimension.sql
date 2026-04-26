ALTER TABLE public.product_attribute
  ADD COLUMN IF NOT EXISTS dimension text
  CHECK (dimension IN ('mass', 'volume', 'count') OR dimension IS NULL);

COMMENT ON COLUMN public.product_attribute.dimension IS
  'For data_type=quantity attributes: which physical dimension this measures (mass, volume, count). NULL for non-quantity attributes.';

UPDATE public.product_attribute
SET dimension = 'mass'
WHERE data_type = 'quantity' AND dimension IS NULL;
