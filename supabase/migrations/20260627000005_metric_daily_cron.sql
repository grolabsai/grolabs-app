-- Conversion-Measurement Foundations (B1) — nightly rollup refresh.
--
-- Materializes YESTERDAY's metric_daily rows every night (the current day is
-- excluded so a partial day never reads as a drop — same convention as GA4's
-- DATA_CUTOFF / "data through yesterday"). Backfill of older history is a
-- manual `select refresh_metric_daily(NULL)` (full rebuild) or per-day calls.
--
-- pg_cron is already used by the blog (blog-publish-due). Idempotent: drop the
-- job if it exists before re-scheduling.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-metric-daily') THEN
    PERFORM cron.unschedule('refresh-metric-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'refresh-metric-daily',
  '20 5 * * *',   -- 05:20 UTC nightly
  $$SELECT public.refresh_metric_daily((now() AT TIME ZONE 'utc')::date - 1)$$
);

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000005',
  'B1 conversion-measurement: nightly pg_cron (refresh-metric-daily) materializing yesterday into metric_daily'
)
ON CONFLICT (version) DO NOTHING;
