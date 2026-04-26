-- =============================================================================
-- Fix unit_of_measure.to_si_factor values
-- =============================================================================
-- The initial seed (20260426000003) used values that normalise to kg/l instead
-- of g/ml as specified. The invariant is: value × to_si_factor = SI base amount.
--
--   mass:   si_base_unit = 'g'  → factor is grams per unit
--   volume: si_base_unit = 'ml' → factor is millilitres per unit
--   count:  si_base_unit = 'ea' → factor is 1
--
-- Also corrects the missing accent in 'Onza liquida' → 'Onza líquida'.
-- =============================================================================

UPDATE public.unit_of_measure SET to_si_factor = 1000,    name = 'Kilogramo'    WHERE code = 'kg';
UPDATE public.unit_of_measure SET to_si_factor = 1,       name = 'Gramo'        WHERE code = 'g';
UPDATE public.unit_of_measure SET to_si_factor = 453.592, name = 'Libra'        WHERE code = 'lb';
UPDATE public.unit_of_measure SET to_si_factor = 28.3495, name = 'Onza'         WHERE code = 'oz';
UPDATE public.unit_of_measure SET to_si_factor = 1000,    name = 'Litro'        WHERE code = 'l';
UPDATE public.unit_of_measure SET to_si_factor = 1,       name = 'Mililitro'    WHERE code = 'ml';
UPDATE public.unit_of_measure SET to_si_factor = 29.5735, name = 'Onza líquida' WHERE code = 'fl_oz';
-- 'ea' is already correct (to_si_factor = 1).

-- Verification: each row that has data should now normalise correctly.
DO $$
DECLARE
  v_bad int;
BEGIN
  -- Spot-check: 1 kg should normalise to 1000 g.
  SELECT COUNT(*) INTO v_bad
  FROM public.unit_of_measure
  WHERE code = 'kg' AND to_si_factor <> 1000;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Fix failed: kg to_si_factor is not 1000';
  END IF;

  -- Spot-check: 1 ml should normalise to 1 ml.
  SELECT COUNT(*) INTO v_bad
  FROM public.unit_of_measure
  WHERE code = 'ml' AND to_si_factor <> 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Fix failed: ml to_si_factor is not 1';
  END IF;

  -- No row should have a factor ≤ 0.
  SELECT COUNT(*) INTO v_bad
  FROM public.unit_of_measure
  WHERE to_si_factor <= 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Fix failed: % rows have to_si_factor <= 0', v_bad;
  END IF;

  RAISE NOTICE 'unit_of_measure to_si_factor correction verified.';
END $$;
