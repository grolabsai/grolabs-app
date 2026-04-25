-- D27: import_staging — temporary holding table for all imports
-- Data lives here until promoted to production tables after user review

CREATE TABLE import_staging (
  staging_id      bigserial PRIMARY KEY,
  instance_id     bigint NOT NULL REFERENCES instance(instance_id),
  job_id          bigint NOT NULL REFERENCES import_job(job_id) ON DELETE CASCADE,
  row_number      int,
  raw_data        jsonb NOT NULL,
  normalized_data jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','mapped','clustered','promoted','rejected','error')),
  cluster_id      text,
  cluster_confidence numeric(5,2),
  proposed_product_id  bigint,
  proposed_variant_id  bigint,
  issues          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_staging_instance ON import_staging(instance_id);
CREATE INDEX idx_import_staging_job      ON import_staging(job_id);
CREATE INDEX idx_import_staging_cluster  ON import_staging(job_id, cluster_id);
CREATE INDEX idx_import_staging_status   ON import_staging(job_id, status);

ALTER TABLE import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY instance_isolation_import_staging_select
  ON import_staging FOR SELECT TO authenticated
  USING (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_staging_insert
  ON import_staging FOR INSERT TO authenticated
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_staging_update
  ON import_staging FOR UPDATE TO authenticated
  USING (instance_id = current_instance_id())
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_staging_delete
  ON import_staging FOR DELETE TO authenticated
  USING (instance_id = current_instance_id());

INSERT INTO scout_schema_version (version, description)
VALUES ('20260425000008', 'D27: import_staging table — temporary holding for imports');
