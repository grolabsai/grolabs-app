-- 20260508000001_product_attribute_parsing_hint.sql
-- Per-attribute parsing hint for the import-wizard agent.
-- Same idea as `category.parsing_note` but per-attribute: lets the user
-- give the agent free-text guidance about how to recognize the attribute
-- in product names. Authoritative — the agent prompt instructs it to
-- weight per-attribute hints heavily over naive name-based matching.

ALTER TABLE public.product_attribute
  ADD COLUMN IF NOT EXISTS parsing_hint text;

COMMENT ON COLUMN public.product_attribute.parsing_hint IS
  'Free-text guidance for the import-wizard agent. Tells the agent how to recognize this attribute in product names (e.g. for boolean medicado: trigger words like "Prescription Diet", "R/D", "K/D"). Authoritative — overrides naive name-based pattern matching.';
