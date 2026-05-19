-- Align ALL import_job CHECK constraints with the values the WC import
-- code actually writes.
--
-- Background: the WooCommerce import flow has hit two separate CHECK
-- violations on import_job:
--   1. import_job_source_type_check — fixed in 20260518000001
--      (added 'woocommerce_categories' / 'woocommerce_products').
--   2. import_job_status_check — this migration. The WC actions
--      (src/app/[locale]/(app)/import/woocommerce/actions.ts) INSERT a
--      row with status = 'in_progress', which the original inline CHECK
--      (migration 20260425000007) never allowed. Every WC import failed
--      at the initial import_job INSERT.
--
-- This migration redefines BOTH CHECK constraints from a single audited
-- source of truth so future maintainers have one place to reconcile the
-- enum against the code. No existing allowed value is removed (the
-- constraints are only widened, never narrowed).
--
-- ── import_job.source_type — accepted values ───────────────────────────
--   single_text            text-paste import
--   excel                  Excel upload import
--   csv                    CSV upload import
--   bulk_migration         bulk migration import
--   url                    URL-sourced import
--   woocommerce_categories WC categories pull  (actions.ts)
--   woocommerce_products   WC products pull    (actions.ts)
--
-- ── import_job.status — accepted values ────────────────────────────────
--   pending      created, not yet started        (table default)
--   processing   generic in-flight (legacy pipeline)
--   mapping       column-mapping step (text/CSV/Excel pipeline)
--   review        awaiting user review
--   in_progress   WC import running               (actions.ts INSERT)
--   completed     finished successfully           (actions.ts)
--   failed        finished with fatal error       (actions.ts)
--
-- NOTE: 'in_progress' (WC code) and 'processing' (legacy enum) are
-- semantically the same state but spelled differently. Both are kept so
-- this migration does not narrow the constraint and does not require a
-- code change. Consolidating to one spelling is left as future cleanup.

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

ALTER TABLE import_job DROP CONSTRAINT import_job_status_check;

ALTER TABLE import_job ADD CONSTRAINT import_job_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'mapping',
    'review',
    'in_progress',
    'completed',
    'failed'
  ));
