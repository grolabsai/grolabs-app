-- Add an upsert-friendly natural key to product_attribute_option.
--
-- Today the only unique index is the primary key (value_id). The WC import
-- needs to dedupe options across re-runs: when the same axis value (e.g.
-- "Rojo" on the size axis of multiple products) appears repeatedly, we
-- must upsert against a stable key rather than creating duplicates each
-- time. value_code is the slug-normalised form of the value ("rojo") and is
-- the natural key the GroLabs UI already uses to keep options tidy across
-- locales / typing variations.
--
-- Existing rows on the live database all populate value_code with no
-- duplicates (verified before the migration ran), so this index can be
-- created without backfill. NULLs are still allowed (treated as DISTINCT
-- per the PG15 default) for any legacy import path that hasn't been
-- updated to emit a code yet.

create unique index if not exists uq_product_attribute_option_code
  on public.product_attribute_option (instance_id, attribute_id, value_code);

comment on column public.product_attribute_option.value_code is
  'Slug-normalised value used as the natural upsert key by importers. Unique per (instance, attribute) when present.';
