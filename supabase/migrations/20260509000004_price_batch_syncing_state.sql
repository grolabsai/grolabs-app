-- WooCommerce sync for price batches.
--
--  - Adds a 'syncing' transient status so two operators clicking
--    "Sincronizar" simultaneously can't both proceed (the claim step
--    becomes an UPDATE … WHERE status='ready' that returns 1 or 0 rows).
--  - Adds last_sync_log_id on price_batch so the worksheet can link
--    back to the most recent attempt.
--  - Adds price_batch_id on sync_log so the /pricing/sync history
--    table can attribute each row to its originating batch (catalog
--    syncs leave it null).

ALTER TABLE price_batch DROP CONSTRAINT IF EXISTS price_batch_status_check;
ALTER TABLE price_batch
  ADD CONSTRAINT price_batch_status_check
    CHECK (status IN ('draft', 'ready', 'syncing', 'synced'));

ALTER TABLE price_batch
  ADD COLUMN IF NOT EXISTS last_sync_log_id bigint REFERENCES sync_log(id) ON DELETE SET NULL;

ALTER TABLE sync_log
  ADD COLUMN IF NOT EXISTS price_batch_id bigint REFERENCES price_batch(price_batch_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sync_log_price_batch ON sync_log(price_batch_id) WHERE price_batch_id IS NOT NULL;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260509000004',
        'price_batch.syncing transient status + last_sync_log_id; sync_log.price_batch_id back-reference');
