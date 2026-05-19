-- Allow WooCommerce import job types on import_job.source_type.
-- The original inline CHECK (migration 20260425000007) omitted the
-- 'woocommerce_categories' / 'woocommerce_products' values written by the
-- WC import flow (src/app/[locale]/(app)/import/woocommerce/actions.ts),
-- so every WC import failed the import_job_source_type_check constraint.

ALTER TABLE import_job DROP CONSTRAINT import_job_source_type_check;

ALTER TABLE import_job ADD CONSTRAINT import_job_source_type_check
  CHECK (source_type IN (
    'single_text',
    'excel',
    'csv',
    'bulk_migration',
    'url',
    'woocommerce_categories',
    'woocommerce_products'
  ));
