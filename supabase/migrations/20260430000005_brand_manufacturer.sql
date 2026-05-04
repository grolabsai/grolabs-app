-- ============================================================================
-- Move "manufacturer" from product to brand
-- ----------------------------------------------------------------------------
-- The free-text product.manufacturer column was a design bug:
-- manufacturers create brands, not individual products. The same
-- manufacturer string ended up duplicated across every product of a
-- given brand with inevitable spelling drift.
--
-- This migration:
--   1. Adds a nullable manufacturer text column to brand.
--   2. Drops the product.manufacturer column.
--
-- No data preservation: per the prompt, existing manufacturer values
-- are test/seed-only and don't need to migrate. The brand CRUD UI is
-- out of scope for the PR introducing this migration; the column is
-- created here so it exists for the next iteration.
-- ============================================================================

alter table brand add column if not exists manufacturer text;

alter table product drop column if exists manufacturer;
