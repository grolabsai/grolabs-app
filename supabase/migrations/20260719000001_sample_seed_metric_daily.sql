-- Instance 15 "Sample data set" carries directly-seeded metric_daily demo rows
-- with NO raw events behind them (docs/state/instances.md R-6). The nightly
-- refresh-metric-daily cron (05:20 UTC) deletes the trailing 3 UTC days for ALL
-- instances and rebuilds from raw sources — which permanently erases instance
-- 15's freshest days. This function regenerates them DETERMINISTICALLY (same
-- hashtext salts and weekly targets as the original 2026-07-18 seed, so
-- overlapping days reproduce byte-identical values), and a companion cron job
-- ('sample-data-reseed', 05:50 UTC) runs it right after the refresh so the demo
-- always has data through the store's yesterday.
--
-- Applied to production (project scout) via Supabase MCP on 2026-07-19.

CREATE OR REPLACE FUNCTION public.sample_seed_metric_daily(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.metric_daily
  WHERE instance_id = 15 AND day BETWEEN p_from AND p_to;

  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ), p AS (
    SELECT day,
      ((day - date '2026-04-20') / 7)::int AS wk,
      extract(isodow FROM day)::int AS dow
    FROM days
  ), base AS (
    SELECT day, wk,
      CASE WHEN wk <= 12
        THEN (ARRAY[8.2,8.12,8.22,8.15,8.18,8.1,8.02,7.92,7.8,7.65,7.5,7.32,7.2])[wk+1]
        ELSE 7.15 + ((abs(hashtext('wk'||wk||'c'))%1000)/499.5-1) * 0.08 END AS conv_t,
      CASE WHEN wk <= 12
        THEN (ARRAY[14.5,13.8,14.2,13.2,12.5,11.4,10.2,9.0,8.0,7.0,6.2,5.5,5.3])[wk+1]
        ELSE 5.2 + ((abs(hashtext('wk'||wk||'n'))%1000)/499.5-1) * 0.25 END AS nr_t,
      CASE WHEN wk <= 12
        THEN (ARRAY[55.5,54.8,56.2,55.1,55.8,54.9,55.4,56.0,55.2,55.7,54.6,55.3,55.0])[wk+1]
        ELSE 55.2 + ((abs(hashtext('wk'||wk||'t'))%1000)/499.5-1) * 0.6 END AS ctr_t,
      CASE WHEN wk <= 12
        THEN (ARRAY[92,95,98,101,105,108,111,114,118,121,124,128,130])[wk+1]::numeric
        ELSE LEAST(128 + (wk - 12) * 2, 145)::numeric END AS lvl,
      CASE dow WHEN 1 THEN 0.95 WHEN 2 THEN 0.90 WHEN 3 THEN 0.92 WHEN 4 THEN 1.00
               WHEN 5 THEN 1.12 WHEN 6 THEN 1.30 ELSE 1.18 END AS mult,
      (abs(hashtext(day::text||'s1'))%1000)/499.5-1 AS n1,
      (abs(hashtext(day::text||'s2'))%1000)/499.5-1 AS n2,
      (abs(hashtext(day::text||'s3'))%1000)/499.5-1 AS n3,
      (abs(hashtext(day::text||'s4'))%1000)/499.5-1 AS n4,
      (abs(hashtext(day::text||'u5'))%1000)/499.5-1 AS n5,
      (abs(hashtext(day::text||'s6'))%1000)/499.5-1 AS n6,
      (abs(hashtext(day::text||'s7'))%1000)/499.5-1 AS n7,
      (abs(hashtext(day::text||'s8'))%1000)/499.5-1 AS n8,
      (abs(hashtext(day::text||'s9'))%1000)/499.5-1 AS n9,
      (abs(hashtext(day::text||'s10'))%1000)/499.5-1 AS n10
    FROM p
  ), v1 AS (
    SELECT *, GREATEST(20, round(lvl*mult*(1+n1*0.08)))::numeric AS sessions FROM base
  ), v2 AS (
    SELECT *,
      GREATEST(15, round(sessions*(1.55+n2*0.08)))::numeric AS searches,
      GREATEST(1, round(sessions*conv_t/100*(1+n5*0.03)))::numeric AS orders,
      round((52+n6*6)::numeric, 2) AS aov
    FROM v1
  ), v3 AS (
    SELECT *,
      round(searches*nr_t/100*(1+n3*0.10))::numeric AS zeros,
      round(searches*ctr_t/100*(1+n4*0.05))::numeric AS clicks,
      GREATEST(1, round(searches*(0.24+n7*0.03)))::numeric AS carts,
      round(orders*aov, 2) AS sales,
      GREATEST(1, round(orders*(1.6+n8*0.25)))::numeric AS items,
      round((3.1+n10*0.5)::numeric, 2) AS clickpos
    FROM v2
  ), v4 AS (
    SELECT *,
      GREATEST(1, round(carts*(0.34+n9*0.04)))::numeric AS checkouts,
      GREATEST(0, round(searches*(0.042+n9*0.008)))::numeric AS s2p
    FROM v3
  )
  INSERT INTO public.metric_daily (instance_id, day, metric_key, grain, numerator, denominator, value, sample_size)
  SELECT 15, v4.day, r.metric_key, r.grain, r.num, r.den, r.value, COALESCE(r.den, r.value)::int
  FROM v4
  CROSS JOIN LATERAL (VALUES
    ('total_sales', 'event', NULL::numeric, NULL::numeric, v4.sales),
    ('orders', 'event', NULL, NULL, v4.orders),
    ('aov', 'event', v4.sales, v4.orders, round(v4.sales/NULLIF(v4.orders,0), 4)),
    ('avg_items_per_order', 'event', v4.items, v4.orders, round(v4.items/NULLIF(v4.orders,0), 4)),
    ('session_conversion', 'session', v4.orders, v4.sessions, round(v4.orders/NULLIF(v4.sessions,0), 6)),
    ('search_volume', 'search', NULL, NULL, v4.searches),
    ('zero_result_searches', 'search', NULL, NULL, v4.zeros),
    ('no_result_rate', 'search', v4.zeros, v4.searches, round(v4.zeros/NULLIF(v4.searches,0), 6)),
    ('search_ctr', 'search', v4.clicks, v4.searches, round(v4.clicks/NULLIF(v4.searches,0), 6)),
    ('avg_click_position', 'click', round(v4.clickpos*v4.clicks, 2), v4.clicks, v4.clickpos),
    ('cart_to_checkout', 'event', v4.checkouts, v4.carts, round(v4.checkouts/NULLIF(v4.carts,0), 6)),
    ('search_to_purchase', 'intent', v4.s2p, v4.searches, round(v4.s2p/NULLIF(v4.searches,0), 6))
  ) AS r(metric_key, grain, num, den, value);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- Nightly re-seed at 05:50 UTC — 30 min after the refresh-metric-daily job
-- (05:20 UTC) that wipes the trailing 3 UTC days.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sample-data-reseed') THEN
    PERFORM cron.unschedule('sample-data-reseed');
  END IF;
  PERFORM cron.schedule(
    'sample-data-reseed',
    '50 5 * * *',
    $cmd$SELECT public.sample_seed_metric_daily(((now() AT TIME ZONE 'utc')::date - 3), ((now() AT TIME ZONE 'utc')::date - 1))$cmd$
  );
END $$;
