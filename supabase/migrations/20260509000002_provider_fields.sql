-- Provider table fields, expanded.
-- The original migration (20260508000002) shipped with a flat `contact_info`
-- jsonb blob which is poorly-suited to filtering and form rendering. Since
-- the table is empty, drop the JSONB column and replace with proper text
-- fields organised by section: identity, contact, address, commercial,
-- banking. All values are stored as text per product decision — typed
-- constraints (currency enum, country code length, etc.) can be tightened
-- later if needed.

ALTER TABLE provider DROP COLUMN IF EXISTS contact_info;

ALTER TABLE provider
  -- Identity
  ADD COLUMN IF NOT EXISTS legal_name           text,
  ADD COLUMN IF NOT EXISTS tax_id               text,
  -- Contact
  ADD COLUMN IF NOT EXISTS contact_name         text,
  ADD COLUMN IF NOT EXISTS email                text,
  ADD COLUMN IF NOT EXISTS phone                text,
  ADD COLUMN IF NOT EXISTS website              text,
  -- Address
  ADD COLUMN IF NOT EXISTS address_line         text,
  ADD COLUMN IF NOT EXISTS city                 text,
  ADD COLUMN IF NOT EXISTS country              text DEFAULT 'GT',
  -- Commercial
  ADD COLUMN IF NOT EXISTS default_currency     text DEFAULT 'GTQ',
  ADD COLUMN IF NOT EXISTS consignment          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes                text,
  -- Banking
  ADD COLUMN IF NOT EXISTS bank_name            text,
  ADD COLUMN IF NOT EXISTS bank_account_number  text;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260509000002',
        'provider: drop contact_info jsonb, add flat identity/contact/address/commercial/banking columns + consignment');
