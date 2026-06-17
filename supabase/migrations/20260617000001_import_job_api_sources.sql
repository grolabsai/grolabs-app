-- Bulk intake: extend the EXISTING import_job / import_staging tables to back
-- API-driven, multi-part, platform intake sessions. No new tables — we reuse the
-- UI wizard's pipeline so there is one definition of an import. Additive only.
-- See docs/design/bulk-intake.md and docs/design/bulk-intake-build-plan.md (P2).
--
-- NOTE: the CHECK sets below are the LIVE constraint values (verified against the
-- scout project), not the original migration file's — the live constraints had
-- drifted (woocommerce_categories/products on source_type, in_progress on status).
-- We preserve every existing value and only ADD to it, so existing rows and WC
-- import keep working.

-- 1. Allow platform / API / SDK source types alongside the existing ones.
ALTER TABLE import_job DROP CONSTRAINT import_job_source_type_check;
ALTER TABLE import_job ADD CONSTRAINT import_job_source_type_check
  CHECK (source_type IN (
    -- existing (live) values — preserved
    'single_text','excel','csv','bulk_migration','url',
    'woocommerce_categories','woocommerce_products',
    -- new: platform / SDK sources
    'api','shopify','woocommerce','custom'
  ));

-- 2. Add a 'collecting' status for accept-fast multi-part sessions: parts upload
--    into import_staging, then the session is marked complete and processed.
ALTER TABLE import_job DROP CONSTRAINT import_job_status_check;
ALTER TABLE import_job ADD CONSTRAINT import_job_status_check
  CHECK (status IN (
    -- existing (live) values — preserved
    'pending','processing','mapping','review','in_progress','completed','failed',
    -- new: accept-fast multi-part collection phase
    'collecting'
  ));

-- 3. Home for the optional data dictionary (part/table -> meaning + link keys)
--    a custom source can send alongside a multi-table dump. Nullable.
ALTER TABLE import_job ADD COLUMN IF NOT EXISTS data_dictionary jsonb;

-- 4. Tag which part/role a staging row came from in a multi-part session
--    (e.g. 'products','variants','categories','attributes') so the stitch step
--    can reassemble product objects. Nullable — single-file imports leave it null.
ALTER TABLE import_staging ADD COLUMN IF NOT EXISTS part_role text;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260617000001',
  'Bulk intake: import_job API/platform source types + collecting status + data_dictionary; import_staging.part_role');
