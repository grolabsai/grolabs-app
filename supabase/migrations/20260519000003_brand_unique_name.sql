-- Case-insensitive unique on brand(instance_id, brand_name).
--
-- Two importers (the WC pull and the upcoming text/Excel inline-create
-- flow) both want to upsert/dedupe brands by name. Without a unique
-- constraint, repeated runs (or rapid double-clicks on the "+ Crear"
-- combobox row) would create duplicate brand rows. Case-insensitive so
-- "Hills" and "hills" collapse to one row — typical merchant typing.
--
-- Expression index: unique on (instance_id, lower(brand_name)). NULLs are
-- not relevant here (brand_name is NOT NULL). Existing rows pass — no
-- backfill needed (checked: no within-instance case-insensitive dupes on
-- the live DB).

create unique index if not exists uq_brand_instance_lower_name
  on public.brand (instance_id, lower(brand_name));

comment on column public.brand.brand_name is
  'Display name. Unique per instance ignoring case (uq_brand_instance_lower_name) — importers and the inline-create UI rely on this for dedup.';
