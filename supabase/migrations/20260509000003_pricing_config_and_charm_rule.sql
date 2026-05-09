-- Pricing module: instance-level pricing config + charm-rule table.
--
-- pricing_config (jsonb on instance) holds:
--   calculation_mode: 'margin' | 'markup'   — default 'margin'
--   default_target_pct: number              — default 40
--   default_min_pct: number                 — default 20
--
-- charm_rule applies a psychological-pricing strategy to a price band.
-- Multiple rules may match a given price; the worksheet resolves them in
-- (sort_order ASC, charm_rule_id ASC) so the user has explicit control.

ALTER TABLE instance
  ADD COLUMN IF NOT EXISTS pricing_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE charm_rule (
  charm_rule_id   bigserial PRIMARY KEY,
  instance_id     bigint NOT NULL REFERENCES instance(instance_id),
  min_price       numeric(12,2) NOT NULL CHECK (min_price >= 0),
  max_price       numeric(12,2) CHECK (max_price IS NULL OR max_price >= min_price),
  strategy        text NOT NULL CHECK (strategy IN ('ends_in', 'round_to', 'fixed_offset')),
  strategy_value  numeric(12,2) NOT NULL CHECK (strategy_value >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 100,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_charm_rule_instance ON charm_rule(instance_id);
CREATE INDEX idx_charm_rule_active   ON charm_rule(instance_id, is_active) WHERE is_active = true;
CREATE INDEX idx_charm_rule_band     ON charm_rule(instance_id, min_price, max_price);

CREATE TRIGGER trg_charm_rule_updated
  BEFORE UPDATE ON charm_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE charm_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY instance_isolation_charm_rule_select
  ON charm_rule FOR SELECT TO authenticated
  USING (instance_id = current_instance_id());

CREATE POLICY instance_isolation_charm_rule_insert
  ON charm_rule FOR INSERT TO authenticated
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_charm_rule_update
  ON charm_rule FOR UPDATE TO authenticated
  USING (instance_id = current_instance_id())
  WITH CHECK (instance_id = current_instance_id());

CREATE POLICY instance_isolation_charm_rule_delete
  ON charm_rule FOR DELETE TO authenticated
  USING (instance_id = current_instance_id());

INSERT INTO scout_schema_version (version, description)
VALUES ('20260509000003',
        'instance.pricing_config jsonb + charm_rule table (psychological-pricing bands)');
