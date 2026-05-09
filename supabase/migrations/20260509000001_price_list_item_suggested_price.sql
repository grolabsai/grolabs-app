-- Provider price lists frequently include both the cost and a suggested
-- retail price (PVP / precio sugerido / MSRP). The pricing worksheet uses the
-- suggested price as a reference when the user is deciding on a final
-- selling price, so we capture it on the line item itself.

ALTER TABLE price_list_item
  ADD COLUMN IF NOT EXISTS suggested_retail_price numeric(12,2)
    CHECK (suggested_retail_price IS NULL OR suggested_retail_price >= 0);

INSERT INTO scout_schema_version (version, description)
VALUES ('20260509000001',
        'price_list_item.suggested_retail_price for provider PVP / MSRP reference');
