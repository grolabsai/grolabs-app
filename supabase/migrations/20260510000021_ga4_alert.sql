-- GA4 alert state.
-- Per docs/policy/ga4-integration.md §6 (top-3 alert pipeline).
--
-- Lifecycle: firing → acknowledged → cleared. The anomaly job dedupes by
-- (instance_id, metric, dimension_key): a subsequent breach updates the
-- existing 'firing' row's observed_value/fired_at instead of inserting a
-- duplicate. When the metric returns to within threshold, the existing row
-- transitions to 'cleared' and a new alert can fire.

CREATE TABLE ga4_alert (
  alert_id        bigserial   PRIMARY KEY,
  instance_id     bigint      NOT NULL REFERENCES instance(instance_id),
  metric          text        NOT NULL CHECK (metric IN ('sessions', 'engagement_rate', 'traffic_share')),
  -- Optional dimension scope, e.g. 'source/medium=google/organic'. Null means
  -- the alert is for the top-line metric (sessions, engagement_rate).
  dimension_key   text,
  baseline_value  numeric     NOT NULL,
  observed_value  numeric     NOT NULL,
  -- Signed: -15.0 means observed dropped 15% vs baseline.
  delta_pct       numeric     NOT NULL,
  status          text        NOT NULL DEFAULT 'firing' CHECK (status IN ('firing', 'acknowledged', 'cleared')),
  fired_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  cleared_at      timestamptz
);

-- Inbox query: firing alerts for an instance, newest first.
CREATE INDEX ix_ga4_alert_instance_status
  ON ga4_alert(instance_id, status, fired_at DESC);

-- Dedup lookup for the anomaly job.
CREATE INDEX ix_ga4_alert_dedup
  ON ga4_alert(instance_id, metric, dimension_key, status);

ALTER TABLE ga4_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY instance_isolation_ga4_alert_select ON ga4_alert FOR SELECT TO authenticated
  USING (instance_id = current_instance_id());

CREATE POLICY instance_isolation_ga4_alert_insert ON ga4_alert FOR INSERT TO authenticated
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_ga4_alert_update ON ga4_alert FOR UPDATE TO authenticated
  USING (instance_id = current_instance_id())
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_ga4_alert_delete ON ga4_alert FOR DELETE TO authenticated
  USING (instance_id = current_instance_id());

INSERT INTO scout_schema_version (version, description)
VALUES ('20260510000021', 'GA4: ga4_alert table + lifecycle + instance_isolation RLS');
