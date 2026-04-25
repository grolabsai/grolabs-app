-- D27: import_job — tracks each import session
-- One row per import action (single text entry, Excel upload, bulk migration)

CREATE TABLE import_job (
  job_id        bigserial PRIMARY KEY,
  instance_id   bigint NOT NULL REFERENCES instance(instance_id),
  source_type   text NOT NULL
                  CHECK (source_type IN ('single_text','excel','csv','bulk_migration','url')),
  filename      text,
  raw_input     text,
  row_count     int,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','mapping','review','completed','failed')),
  column_mapping jsonb,
  target_category_id bigint REFERENCES category(category_id),
  error_message text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX idx_import_job_instance ON import_job(instance_id);
CREATE INDEX idx_import_job_status   ON import_job(instance_id, status);

CREATE TRIGGER trg_import_job_updated
  BEFORE UPDATE ON import_job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE import_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY instance_isolation_import_job_select
  ON import_job FOR SELECT TO authenticated
  USING (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_job_insert
  ON import_job FOR INSERT TO authenticated
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_job_update
  ON import_job FOR UPDATE TO authenticated
  USING (instance_id = current_instance_id())
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_import_job_delete
  ON import_job FOR DELETE TO authenticated
  USING (instance_id = current_instance_id());

INSERT INTO scout_schema_version (version, description)
VALUES ('20260425000007', 'D27: import_job table for catalog intelligence pipeline');
