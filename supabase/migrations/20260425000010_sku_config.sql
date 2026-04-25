-- D27: SKU generation config per instance + generator functions
-- Phase 1: pure numeric auto-increment. Field is text to allow future prefix patterns.

ALTER TABLE instance
  ADD COLUMN IF NOT EXISTS sku_config jsonb NOT NULL DEFAULT '{
    "prefix": "",
    "padding": 5,
    "next_number": 1
  }'::jsonb;

COMMENT ON COLUMN instance.sku_config IS
  'SKU generation settings. prefix: optional text prefix. padding: zero-pad width. next_number: next auto-increment value.';

-- fn_generate_sku: atomic SKU generation (row-locked to prevent duplicates)
CREATE OR REPLACE FUNCTION fn_generate_sku(p_instance_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config jsonb;
  v_prefix text;
  v_padding int;
  v_next int;
  v_sku text;
BEGIN
  SELECT sku_config INTO v_config
  FROM instance WHERE instance_id = p_instance_id FOR UPDATE;

  IF v_config IS NULL THEN
    RAISE EXCEPTION 'Instance % not found or has no SKU config', p_instance_id;
  END IF;

  v_prefix  := COALESCE(v_config->>'prefix', '');
  v_padding := COALESCE((v_config->>'padding')::int, 5);
  v_next    := COALESCE((v_config->>'next_number')::int, 1);

  v_sku := v_prefix || lpad(v_next::text, v_padding, '0');

  UPDATE instance
  SET sku_config = jsonb_set(sku_config, '{next_number}', to_jsonb(v_next + 1))
  WHERE instance_id = p_instance_id;

  RETURN v_sku;
END;
$$;

-- Batch version: generate N SKUs at once
CREATE OR REPLACE FUNCTION fn_generate_sku_batch(p_instance_id bigint, p_count int)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config jsonb;
  v_prefix text;
  v_padding int;
  v_next int;
  v_skus text[] := '{}';
  i int;
BEGIN
  SELECT sku_config INTO v_config
  FROM instance WHERE instance_id = p_instance_id FOR UPDATE;

  IF v_config IS NULL THEN
    RAISE EXCEPTION 'Instance % not found or has no SKU config', p_instance_id;
  END IF;

  v_prefix  := COALESCE(v_config->>'prefix', '');
  v_padding := COALESCE((v_config->>'padding')::int, 5);
  v_next    := COALESCE((v_config->>'next_number')::int, 1);

  FOR i IN 1..p_count LOOP
    v_skus := array_append(v_skus, v_prefix || lpad((v_next + i - 1)::text, v_padding, '0'));
  END LOOP;

  UPDATE instance
  SET sku_config = jsonb_set(sku_config, '{next_number}', to_jsonb(v_next + p_count))
  WHERE instance_id = p_instance_id;

  RETURN v_skus;
END;
$$;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260425000010', 'D27: SKU config on instance + fn_generate_sku / fn_generate_sku_batch');
