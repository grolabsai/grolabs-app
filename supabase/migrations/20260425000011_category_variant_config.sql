-- D27: Add variant axis defaults + parsing note to category
-- These guide the AI agent when parsing product names for this category

ALTER TABLE category
  ADD COLUMN IF NOT EXISTS default_variant_axes text[]
    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS parsing_note text;

COMMENT ON COLUMN category.default_variant_axes IS
  'Expected variant axes for products in this category. E.g. [weight] for pet food, [size, color] for clothes. Agent uses these to distinguish variant values from attribute values.';

COMMENT ON COLUMN category.parsing_note IS
  'Optional natural language hint for the AI parser. Only needed for ambiguous cases.';

INSERT INTO scout_schema_version (version, description)
VALUES ('20260425000011', 'D27: default_variant_axes + parsing_note on category for AI parser guidance');
