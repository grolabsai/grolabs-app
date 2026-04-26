-- =============================================================================
-- unit_of_measure and quantity type
-- =============================================================================
-- Phases 1–8: schema, content attribute, variant axis backfill, weight backfill,
-- and invariant verification. Phase 9 (apply to live DB) is done via MCP after commit.
-- Phase 10 (UI primitive) is deferred to a follow-up PR.
--
-- Background: replaces the weight_kg / weight_lb / volume_ml attribute pattern
-- with a single 'content' attribute that pairs a numeric value with a
-- unit_of_measure reference. The old attributes are kept (marked DEPRECATED) and
-- all existing data is backfilled into the new structure.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 — unit_of_measure table (global reference data)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.unit_of_measure (
  unit_id        bigserial PRIMARY KEY,
  code           text        UNIQUE NOT NULL,  -- 'kg', 'g', 'lb', 'oz', 'ml', 'l', 'fl_oz', 'ea'
  name           text        NOT NULL,          -- "Kilogramo", "Gramo", etc.
  dimension      text        NOT NULL,          -- 'mass', 'volume', 'count'
  to_si_factor   numeric     NOT NULL,          -- multiply value by this to get SI base unit
  si_base_unit   text        NOT NULL,          -- the SI base unit code for this dimension
  is_active      boolean     NOT NULL DEFAULT true,
  sort_order     int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (dimension IN ('mass', 'volume', 'count')),
  CHECK (to_si_factor > 0)
);

-- SI base for mass is g (not kg): pet food masses normalise to grams.
-- SI base for volume is ml. to_si_factor × value = normalised SI amount.

CREATE TRIGGER trg_unit_of_measure_updated
  BEFORE UPDATE ON public.unit_of_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_uom_dimension
  ON public.unit_of_measure(dimension)
  WHERE is_active = true;

-- Global reference data — public read, writes via service role only.
ALTER TABLE public.unit_of_measure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uom_read_all"
  ON public.unit_of_measure
  FOR SELECT
  USING (true);

INSERT INTO public.unit_of_measure
  (code,    name,            dimension, to_si_factor, si_base_unit, sort_order)
VALUES
  ('kg',    'Kilogramo',     'mass',    1,            'g',          10),
  ('g',     'Gramo',         'mass',    0.001,        'g',          20),
  ('lb',    'Libra',         'mass',    0.453592,     'g',          30),
  ('oz',    'Onza',          'mass',    0.0283495,    'g',          40),
  ('l',     'Litro',         'volume',  1,            'ml',         50),
  ('ml',    'Mililitro',     'volume',  0.001,        'ml',         60),
  ('fl_oz', 'Onza líquida',  'volume',  0.0295735,    'ml',         70),
  ('ea',    'Unidad',        'count',   1,            'ea',         80);


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 — Add quantity columns to value tables
-- ─────────────────────────────────────────────────────────────────────────────
-- data_type 'quantity' uses value_number + unit_id.
-- data_type 'list' uses value_id, 'text'/'number' use value_text (as before).

ALTER TABLE public.product_attribute_value
  ADD COLUMN value_number numeric,
  ADD COLUMN unit_id      bigint REFERENCES public.unit_of_measure(unit_id);

CREATE INDEX idx_pav_unit
  ON public.product_attribute_value(unit_id)
  WHERE unit_id IS NOT NULL;

ALTER TABLE public.product_variant_attribute
  ADD COLUMN value_number numeric,
  ADD COLUMN unit_id      bigint REFERENCES public.unit_of_measure(unit_id);

CREATE INDEX idx_pva_unit
  ON public.product_variant_attribute(unit_id)
  WHERE unit_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3 — Document 'quantity' as a valid data_type value
-- ─────────────────────────────────────────────────────────────────────────────
-- No CHECK constraint added: existing rows with undocumented values would fail.
-- Enforced at the application layer instead.

COMMENT ON COLUMN public.product_attribute.data_type IS
  'Allowed values: list (uses value_id), text (uses value_text), '
  'number (uses value_text parsed), quantity (uses value_number + unit_id). '
  'Enforced at application layer; not constrained at DB level so existing data passes.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4 — Insert 'content' attribute for instances 0 and 1, link to Food
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_attr_id_1 bigint;
BEGIN
  -- Insert for template (instance 0) and Wazu (instance 1)
  INSERT INTO public.product_attribute (
    instance_id, attribute_code, attribute_name, data_type,
    is_filterable, is_searchable, applies_to_variants, is_active
  )
  VALUES
    (0, 'content', 'Contenido', 'quantity', true, false, true, true),
    (1, 'content', 'Contenido', 'quantity', true, false, true, true)
  ON CONFLICT (instance_id, attribute_code) DO NOTHING;

  -- Resolve the instance-1 attribute_id
  SELECT attribute_id INTO v_attr_id_1
  FROM public.product_attribute
  WHERE instance_id = 1 AND attribute_code = 'content';

  -- Link to Alimento (category_id=59, instance_id=1)
  INSERT INTO public.category_product_attribute (
    instance_id, category_id, attribute_id,
    requirement_level, visible_in_filter, visible_in_product_page, form_order
  )
  VALUES (1, 59, v_attr_id_1, 'optional', true, true, 10)
  ON CONFLICT (instance_id, category_id, attribute_id) DO NOTHING;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5 — Variant axis columns on category_product_attribute + backfill
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.category_product_attribute
  ADD COLUMN is_variant_axis      boolean NOT NULL DEFAULT false,
  ADD COLUMN variant_axis_order   int;

CREATE INDEX idx_cpa_variant_axis
  ON public.category_product_attribute(category_id, variant_axis_order)
  WHERE is_variant_axis = true;

COMMENT ON COLUMN public.category_product_attribute.is_variant_axis IS
  'When true, products in this category use this attribute as a variant '
  'differentiator. Replaces deprecated category.default_variant_axes text array.';

COMMENT ON COLUMN public.category_product_attribute.variant_axis_order IS
  'Display and processing order for variant axes within a category. '
  'Lower numbers come first. Used by import agents and storefront facets.';

-- Backfill: for each category with non-empty default_variant_axes, look up
-- matching product_attribute by code within the same instance and mark it as
-- a variant axis. Idempotent via ON CONFLICT DO UPDATE.
DO $$
DECLARE
  v_cat    record;
  v_axis   text;
  v_pos    int;
  v_attr_id bigint;
BEGIN
  FOR v_cat IN
    SELECT category_id, instance_id, default_variant_axes
    FROM public.category
    WHERE default_variant_axes IS NOT NULL
      AND default_variant_axes != '{}'
  LOOP
    v_pos := 1;
    FOREACH v_axis IN ARRAY v_cat.default_variant_axes LOOP
      SELECT attribute_id INTO v_attr_id
      FROM public.product_attribute
      WHERE instance_id = v_cat.instance_id
        AND attribute_code = v_axis
        AND is_active = true
      LIMIT 1;

      IF v_attr_id IS NOT NULL THEN
        INSERT INTO public.category_product_attribute (
          instance_id, category_id, attribute_id,
          is_variant_axis, variant_axis_order
        )
        VALUES (v_cat.instance_id, v_cat.category_id, v_attr_id, true, v_pos)
        ON CONFLICT (instance_id, category_id, attribute_id) DO UPDATE
          SET is_variant_axis    = true,
              variant_axis_order = EXCLUDED.variant_axis_order;
      END IF;

      v_pos := v_pos + 1;
    END LOOP;
  END LOOP;
END $$;

-- Explicitly mark 'content' as the primary variant axis for Alimento (cat 59).
-- default_variant_axes = ['weight'] won't match 'content', so this must be explicit.
DO $$
DECLARE
  v_content_attr_id bigint;
BEGIN
  SELECT attribute_id INTO v_content_attr_id
  FROM public.product_attribute
  WHERE instance_id = 1 AND attribute_code = 'content';

  UPDATE public.category_product_attribute
  SET is_variant_axis    = true,
      variant_axis_order = 1
  WHERE instance_id  = 1
    AND category_id  = 59
    AND attribute_id = v_content_attr_id;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 6 — Deprecate category.default_variant_axes
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.category.default_variant_axes IS
  'DEPRECATED. Replaced by category_product_attribute.is_variant_axis and '
  'variant_axis_order. Will be dropped in a follow-up migration after agent '
  'migration completes.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 7 — Backfill existing weight/volume values into the new content attribute
-- ─────────────────────────────────────────────────────────────────────────────
-- Old rows (weight_kg / weight_lb / volume_ml) are left in place.
-- New content rows carry value_number + unit_id.
-- ON CONFLICT DO NOTHING makes this idempotent.

DO $$
DECLARE
  v_content_attr_id bigint;
  v_kg_unit_id      bigint;
  v_lb_unit_id      bigint;
  v_ml_unit_id      bigint;
  v_rec             record;
BEGIN
  -- Resolve IDs once
  SELECT attribute_id INTO v_content_attr_id
  FROM public.product_attribute
  WHERE instance_id = 1 AND attribute_code = 'content';

  SELECT unit_id INTO v_kg_unit_id FROM public.unit_of_measure WHERE code = 'kg';
  SELECT unit_id INTO v_lb_unit_id FROM public.unit_of_measure WHERE code = 'lb';
  SELECT unit_id INTO v_ml_unit_id FROM public.unit_of_measure WHERE code = 'ml';

  -- ── product_variant_attribute backfill ────────────────────────────────────

  -- weight_kg → content (kg)
  FOR v_rec IN
    SELECT pva.instance_id, pva.variant_id, pva.value_text
    FROM public.product_variant_attribute pva
    JOIN public.product_attribute pa ON pa.attribute_id = pva.attribute_id
    WHERE pa.instance_id = 1
      AND pa.attribute_code = 'weight_kg'
      AND pva.value_text IS NOT NULL
      AND pva.value_text <> ''
  LOOP
    INSERT INTO public.product_variant_attribute
      (instance_id, variant_id, attribute_id, value_number, unit_id)
    VALUES
      (v_rec.instance_id, v_rec.variant_id, v_content_attr_id,
       v_rec.value_text::numeric, v_kg_unit_id)
    ON CONFLICT (instance_id, variant_id, attribute_id) DO NOTHING;
  END LOOP;

  -- weight_lb → content (lb)
  FOR v_rec IN
    SELECT pva.instance_id, pva.variant_id, pva.value_text
    FROM public.product_variant_attribute pva
    JOIN public.product_attribute pa ON pa.attribute_id = pva.attribute_id
    WHERE pa.instance_id = 1
      AND pa.attribute_code = 'weight_lb'
      AND pva.value_text IS NOT NULL
      AND pva.value_text <> ''
  LOOP
    INSERT INTO public.product_variant_attribute
      (instance_id, variant_id, attribute_id, value_number, unit_id)
    VALUES
      (v_rec.instance_id, v_rec.variant_id, v_content_attr_id,
       v_rec.value_text::numeric, v_lb_unit_id)
    ON CONFLICT (instance_id, variant_id, attribute_id) DO NOTHING;
  END LOOP;

  -- volume_ml → content (ml)
  FOR v_rec IN
    SELECT pva.instance_id, pva.variant_id, pva.value_text
    FROM public.product_variant_attribute pva
    JOIN public.product_attribute pa ON pa.attribute_id = pva.attribute_id
    WHERE pa.instance_id = 1
      AND pa.attribute_code = 'volume_ml'
      AND pva.value_text IS NOT NULL
      AND pva.value_text <> ''
  LOOP
    INSERT INTO public.product_variant_attribute
      (instance_id, variant_id, attribute_id, value_number, unit_id)
    VALUES
      (v_rec.instance_id, v_rec.variant_id, v_content_attr_id,
       v_rec.value_text::numeric, v_ml_unit_id)
    ON CONFLICT (instance_id, variant_id, attribute_id) DO NOTHING;
  END LOOP;

  -- ── product_attribute_value backfill ──────────────────────────────────────

  FOR v_rec IN
    SELECT pav.instance_id, pav.product_id, pav.value_text, pa.attribute_code
    FROM public.product_attribute_value pav
    JOIN public.product_attribute pa ON pa.attribute_id = pav.attribute_id
    WHERE pa.instance_id = 1
      AND pa.attribute_code IN ('weight_kg', 'weight_lb', 'volume_ml')
      AND pav.value_text IS NOT NULL
      AND pav.value_text <> ''
  LOOP
    INSERT INTO public.product_attribute_value
      (instance_id, product_id, attribute_id, value_number, unit_id)
    VALUES (
      v_rec.instance_id, v_rec.product_id, v_content_attr_id,
      v_rec.value_text::numeric,
      CASE v_rec.attribute_code
        WHEN 'weight_kg' THEN v_kg_unit_id
        WHEN 'weight_lb' THEN v_lb_unit_id
        WHEN 'volume_ml' THEN v_ml_unit_id
      END
    )
    ON CONFLICT (instance_id, product_id, attribute_id) DO NOTHING;
  END LOOP;

  -- Mark old weight/volume attributes as deprecated (both instances)
  UPDATE public.product_attribute
  SET description = 'DEPRECATED: use content attribute instead'
  WHERE attribute_code IN ('weight_kg', 'weight_lb', 'volume_ml')
    AND instance_id IN (0, 1);

END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 8 — Verification: fail loudly if any invariant is violated
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_count           int;
  v_content_attr_id bigint;
BEGIN

  -- 1. unit_of_measure must have exactly 8 rows
  SELECT COUNT(*) INTO v_count FROM public.unit_of_measure;
  IF v_count <> 8 THEN
    RAISE EXCEPTION 'CHECK 1 FAILED: unit_of_measure has % rows, expected 8', v_count;
  END IF;

  -- 2. exactly 2 content attributes (one per instance 0 and 1)
  SELECT COUNT(*) INTO v_count
  FROM public.product_attribute
  WHERE attribute_code = 'content';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'CHECK 2 FAILED: product_attribute has % content rows, expected 2', v_count;
  END IF;

  -- 3. category 59 / instance 1 has at least one is_variant_axis row with order set
  SELECT COUNT(*) INTO v_count
  FROM public.category_product_attribute
  WHERE category_id       = 59
    AND instance_id       = 1
    AND is_variant_axis   = true
    AND variant_axis_order IS NOT NULL;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'CHECK 3 FAILED: no variant axis with order for category 59 / instance 1';
  END IF;

  -- 4. no is_variant_axis=true row is missing its order
  SELECT COUNT(*) INTO v_count
  FROM public.category_product_attribute
  WHERE is_variant_axis = true AND variant_axis_order IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'CHECK 4 FAILED: % category_product_attribute rows have is_variant_axis=true but NULL variant_axis_order',
      v_count;
  END IF;

  -- 5. for every old weight/volume PVA row, a content row with value_number+unit_id exists
  SELECT attribute_id INTO v_content_attr_id
  FROM public.product_attribute
  WHERE instance_id = 1 AND attribute_code = 'content';

  SELECT COUNT(*) INTO v_count
  FROM public.product_variant_attribute pva
  JOIN public.product_attribute pa ON pa.attribute_id = pva.attribute_id
  WHERE pa.instance_id = 1
    AND pa.attribute_code IN ('weight_kg', 'weight_lb', 'volume_ml')
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variant_attribute c
      WHERE c.instance_id  = pva.instance_id
        AND c.variant_id   = pva.variant_id
        AND c.attribute_id = v_content_attr_id
        AND c.value_number IS NOT NULL
        AND c.unit_id      IS NOT NULL
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'CHECK 5 FAILED: % old weight/volume PVA rows have no corresponding content row',
      v_count;
  END IF;

  RAISE NOTICE 'All invariant checks passed (unit_of_measure, content attributes, variant axes, backfill).';
END $$;
