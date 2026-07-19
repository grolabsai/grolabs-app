-- Revenue-efficiency KPIs (decision 2026-07-19, conversion-measurement
-- foundations §14): revenue_per_session and revenue_per_user join the daily
-- rollup. Rationale: conversion-rate KPIs miss basket-size uplift — if the
-- same share of sessions convert but baskets grow (e.g. better search), only
-- revenue ÷ population moves. Both derive from aggregates the view already
-- computes (sales_order.amount × session/user counts), so the old
-- "events carry no revenue amount" blocker is stale.
--
-- The view body is long; to guarantee fidelity we extend the CURRENT
-- definition in place (append two UNION ALL branches inside the same WITH
-- scope, reusing the so/sess/ud CTEs) rather than restating 300 lines.
-- Applied to production via Supabase MCP on 2026-07-19; verified via
-- metric_daily_source query (instance 12, 6 days, ~$7.50/session).

DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.metric_daily_source'::regclass);
  v := rtrim(trim(v), ';');
  IF v LIKE '%revenue_per_session%' THEN
    RAISE NOTICE 'metric_daily_source already carries revenue_per_session — skipping';
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.metric_daily_source AS ' || v || $q$
 UNION ALL
 SELECT COALESCE(r.instance_id, s2.instance_id) AS instance_id,
    COALESCE(r.day, s2.day) AS day,
    'revenue_per_session'::text AS metric_key,
    'session'::text AS grain,
    COALESCE(r.revenue, 0::numeric) AS numerator,
    COALESCE(s2.sessions, 0)::numeric AS denominator,
    COALESCE(r.revenue, 0::numeric) / NULLIF(s2.sessions, 0)::numeric AS value,
    s2.sessions::integer AS sample_size
   FROM ( SELECT so.instance_id, so.day, sum(so.amount) AS revenue
            FROM so GROUP BY so.instance_id, so.day) r
   FULL JOIN ( SELECT sess.instance_id, sess.day, count(*) AS sessions
            FROM sess GROUP BY sess.instance_id, sess.day) s2
     ON s2.instance_id = r.instance_id AND s2.day = r.day
 UNION ALL
 SELECT COALESCE(r.instance_id, u.instance_id) AS instance_id,
    COALESCE(r.day, u.day) AS day,
    'revenue_per_user'::text AS metric_key,
    'user'::text AS grain,
    COALESCE(r.revenue, 0::numeric) AS numerator,
    COALESCE(u.users, 0)::numeric AS denominator,
    COALESCE(r.revenue, 0::numeric) / NULLIF(u.users, 0)::numeric AS value,
    u.users::integer AS sample_size
   FROM ( SELECT so.instance_id, so.day, sum(so.amount) AS revenue
            FROM so GROUP BY so.instance_id, so.day) r
   FULL JOIN ( SELECT ud.instance_id, ud.day, count(*) AS users
            FROM ud GROUP BY ud.instance_id, ud.day) u
     ON u.instance_id = r.instance_id AND u.day = r.day$q$;
END $$;
