-- Conversion-Measurement Foundations (B1) — the daily rollup table.
--
-- See docs/design/conversion-measurement-foundations.md (KPI grammar) and
-- docs/design/event-tracking.md (the tracking store this rolls up).
--
-- This is the "Aggregates" layer of the five-layer model (unified-findings),
-- in the SAME shape as the shipped GA4 ga4_*_daily snapshots so the spine and
-- the GA4 overlay compose. One NARROW table holds every KPI as a daily row:
--   (instance_id, day, metric_key) -> numerator / denominator / value.
--
-- Design: VIEW-DEFINED + MATERIALIZED. The metric LOGIC lives in the
-- metric_daily_source view (next migration, single source of truth, cheap to
-- change); a nightly cron materializes yesterday's rows here so reads are fast,
-- history is cheap, and the monitor layer has the daily series it needs to
-- detect "metric X down N% vs its 7-day average" (the GA4 anomaly pattern).
--
-- Rate metrics use numerator/denominator (value = num/den). Aggregate metrics
-- (avg position, median latency) use value + sample_size, leaving num/den NULL.

CREATE TABLE IF NOT EXISTS public.metric_daily (
  instance_id  bigint  NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  -- UTC calendar day the metric is computed for.
  day          date    NOT NULL,
  -- Stable identifier, mirrors src/lib/analytics/metrics.ts METRICS[].key.
  metric_key   text    NOT NULL,
  -- Descriptive: search | intent | event | session | journey | user. A property
  -- of the metric (implied by metric_key); stored for filterable reads.
  grain        text    NOT NULL,
  -- Rate metrics: value = numerator / denominator. NULL for pure aggregates.
  numerator    numeric NULL,
  denominator  numeric NULL,
  -- The headline number: a rate (0..1), a mean (avg position), or a quantity.
  value        numeric NULL,
  -- For aggregates / medians: how many observations the value summarizes.
  sample_size  integer NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, day, metric_key)
);

-- Trend reads: one metric across days for an instance.
CREATE INDEX IF NOT EXISTS metric_daily_instance_metric_day_idx
  ON public.metric_daily (instance_id, metric_key, day);

COMMENT ON TABLE public.metric_daily IS
  'Daily KPI rollups (B1 conversion measurement). Materialized nightly from the metric_daily_source view. One row per (instance_id, day, metric_key). Rate metrics use numerator/denominator; aggregates use value + sample_size. Same shape family as ga4_*_daily.';

ALTER TABLE public.metric_daily ENABLE ROW LEVEL SECURITY;

-- Reads: members of the instance (mirrors analytics_event / query_log).
DROP POLICY IF EXISTS metric_daily_select ON public.metric_daily;
CREATE POLICY metric_daily_select
  ON public.metric_daily
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- Writes: only the refresh function (SECURITY DEFINER) / service_role. No
-- direct authenticated writes.

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000003',
  'B1 conversion-measurement: metric_daily rollup table (narrow per-day KPI store, GA4 *_daily shape)'
)
ON CONFLICT (version) DO NOTHING;
