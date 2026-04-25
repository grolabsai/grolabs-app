-- D27: catalog_suggestion — all AI/agent proposals
-- Nothing writes to production tables until user confirms via this table

CREATE TABLE catalog_suggestion (
  suggestion_id   bigserial PRIMARY KEY,
  instance_id     bigint NOT NULL REFERENCES instance(instance_id),
  job_id          bigint REFERENCES import_job(job_id),
  staging_id      bigint REFERENCES import_staging(staging_id),
  suggestion_type text NOT NULL
                    CHECK (suggestion_type IN (
                      'column_mapping','table_mapping','duplicate_cluster',
                      'product_cluster','variant_structure','attribute_mapping',
                      'category_assignment','brand_match','sku_generation',
                      'merge_proposal','broken_product','spelling_correction',
                      'description','faq','aeo'
                    )),
  source_function text,
  entity_type     text,
  entity_id       bigint,
  confidence      numeric(5,2),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','edited','rejected')),
  reviewed_by     uuid REFERENCES auth.users(id),
  reviewed_at     timestamptz,
  editor_notes    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_catalog_suggestion_instance  ON catalog_suggestion(instance_id);
CREATE INDEX idx_catalog_suggestion_job       ON catalog_suggestion(job_id);
CREATE INDEX idx_catalog_suggestion_status    ON catalog_suggestion(instance_id, status);
CREATE INDEX idx_catalog_suggestion_type      ON catalog_suggestion(instance_id, suggestion_type);

ALTER TABLE catalog_suggestion ENABLE ROW LEVEL SECURITY;

CREATE POLICY instance_isolation_catalog_suggestion_select
  ON catalog_suggestion FOR SELECT TO authenticated
  USING (instance_id = current_instance_id());

CREATE POLICY instance_isolation_catalog_suggestion_insert
  ON catalog_suggestion FOR INSERT TO authenticated
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_catalog_suggestion_update
  ON catalog_suggestion FOR UPDATE TO authenticated
  USING (instance_id = current_instance_id())
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_catalog_suggestion_delete
  ON catalog_suggestion FOR DELETE TO authenticated
  USING (instance_id = current_instance_id());

INSERT INTO scout_schema_version (version, description)
VALUES ('20260425000009', 'D27: catalog_suggestion table — AI/agent proposals for human review');
