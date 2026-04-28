-- Products CRUD: create_variant_with_pricing
-- Atomically inserts product_variant + axis attribute values + retail pricing row.
-- The application layer resolves instance_id via currentInstanceId() and passes it in.
-- The function re-verifies instance membership so it cannot be mis-called cross-instance.

CREATE OR REPLACE FUNCTION create_variant_with_pricing(
  p_instance_id  bigint,
  p_product_id   bigint,
  p_variant_name text,
  p_variant_label text,
  p_sku          text,
  p_image_url    text,
  p_list_price   numeric,
  p_axis_values  jsonb
  -- [{attribute_id, value_id, value_text, value_number, unit_id}]
  -- value_id / value_number / unit_id may be null; use JSON null, not the string "null"
)
RETURNS bigint  -- newly created variant_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant_id bigint;
  v_axis       jsonb;
BEGIN
  -- Verify caller belongs to this instance
  IF NOT EXISTS (
    SELECT 1 FROM instance_member
    WHERE user_id = auth.uid() AND instance_id = p_instance_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify product belongs to this instance
  IF NOT EXISTS (
    SELECT 1 FROM product
    WHERE product_id = p_product_id AND instance_id = p_instance_id
  ) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Insert variant row
  INSERT INTO product_variant (
    instance_id, product_id, variant_name, variant_label,
    sku, image_url, is_active
  ) VALUES (
    p_instance_id,
    p_product_id,
    p_variant_name,
    p_variant_label,
    p_sku,
    NULLIF(p_image_url, ''),
    true
  )
  RETURNING variant_id INTO v_variant_id;

  -- Insert one row per axis value
  FOR v_axis IN SELECT * FROM jsonb_array_elements(p_axis_values) LOOP
    INSERT INTO product_variant_attribute (
      instance_id, variant_id, attribute_id,
      value_id, value_text, value_number, unit_id
    ) VALUES (
      p_instance_id,
      v_variant_id,
      (v_axis->>'attribute_id')::bigint,
      CASE WHEN (v_axis->>'value_id') IS NOT NULL THEN (v_axis->>'value_id')::bigint ELSE NULL END,
      NULLIF(v_axis->>'value_text', ''),
      CASE WHEN (v_axis->>'value_number') IS NOT NULL THEN (v_axis->>'value_number')::numeric ELSE NULL END,
      CASE WHEN (v_axis->>'unit_id') IS NOT NULL THEN (v_axis->>'unit_id')::bigint ELSE NULL END
    );
  END LOOP;

  -- Insert retail pricing row
  INSERT INTO product_pricing (
    instance_id, variant_id, channel, currency,
    list_price, is_active, min_quantity
  ) VALUES (
    p_instance_id, v_variant_id, 'retail', 'GTQ',
    p_list_price, true, 1
  );

  RETURN v_variant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_variant_with_pricing(bigint, bigint, text, text, text, text, numeric, jsonb)
  TO authenticated;
