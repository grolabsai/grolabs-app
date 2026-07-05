-- Fix refresh_metric_daily(NULL): the full-rebuild branch ran `DELETE FROM
-- metric_daily` with no WHERE clause, which Supabase's safe-update guard
-- rejects when the RPC is called through the API (21000: DELETE requires a
-- WHERE clause) — so the documented backfill/restate-history path was unusable
-- from any API caller (emulator, server actions). `WHERE true` satisfies the
-- guard and is semantically identical. Per-day branch unchanged.
CREATE OR REPLACE FUNCTION public.refresh_metric_daily(p_day date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF p_day IS NULL THEN
    DELETE FROM public.metric_daily WHERE true;
    INSERT INTO public.metric_daily
      (instance_id, day, metric_key, grain, numerator, denominator, value, sample_size)
    SELECT instance_id, day, metric_key, grain, numerator, denominator, value, sample_size
    FROM public.metric_daily_source;
  ELSE
    DELETE FROM public.metric_daily WHERE day = p_day;
    INSERT INTO public.metric_daily
      (instance_id, day, metric_key, grain, numerator, denominator, value, sample_size)
    SELECT instance_id, day, metric_key, grain, numerator, denominator, value, sample_size
    FROM public.metric_daily_source WHERE day = p_day;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.refresh_metric_daily(date) IS
  'Materializes metric_daily_source into metric_daily. NULL = full rebuild (backfill); a date = one day (nightly cron). B1.';
