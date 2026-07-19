-- Canonical full restatement of metric_daily_source including the
-- revenue-efficiency KPIs (revenue_per_session, revenue_per_user) added in
-- 20260719000002. That migration extended the view in place via a DO block,
-- which the catalog anti-drift test (tests/unit/analytics/metrics.test.ts)
-- rightly rejects: the LATEST view migration must spell out every emitted
-- metric_key. This file is the previous full definition
-- (20260705000001_instance_timezone_day_bucketing.sql) plus the two new
-- branches — semantically identical to what production already runs.
-- Applied via Supabase MCP on 2026-07-19 (idempotent CREATE OR REPLACE).

create or replace view public.metric_daily_source as
WITH cs AS (
  SELECT query_log.instance_id, query_log.created_at, public.instance_day(query_log.instance_id, query_log.created_at) AS day,
         query_log.query_uid, query_log.total_hits
  FROM query_log WHERE query_log.is_committed IS NOT FALSE
), clk AS (
  SELECT analytics_event.instance_id, analytics_event.created_at, public.instance_day(analytics_event.instance_id, analytics_event.created_at) AS day,
         analytics_event.query_uid, analytics_event."position"
  FROM analytics_event WHERE analytics_event.event_type = 'click'::text
), conv AS (
  SELECT analytics_event.instance_id, public.instance_day(analytics_event.instance_id, analytics_event.created_at) AS day, analytics_event.event_name,
         analytics_event.query_uid, analytics_event.order_id
  FROM analytics_event WHERE analytics_event.event_type = 'conversion'::text
), vw AS (
  SELECT analytics_event.instance_id, public.instance_day(analytics_event.instance_id, analytics_event.created_at) AS day, analytics_event.object_id
  FROM analytics_event WHERE analytics_event.event_type = 'view'::text
), so AS (
  SELECT instance_id, public.instance_day(instance_id, created_at) AS day, amount, total_quantity
  FROM sales_order
), sc AS (
  SELECT cs.instance_id, cs.day, cs.total_hits, cs.created_at AS search_ts,
         (SELECT min(c.created_at) FROM clk c WHERE c.instance_id = cs.instance_id AND c.query_uid = cs.query_uid) AS first_click_ts
  FROM cs WHERE cs.query_uid IS NOT NULL
), sess AS (
  SELECT session_assignment.instance_id, session_assignment.user_id, session_assignment.session_seq,
         public.instance_day(session_assignment.instance_id, min(session_assignment.created_at)) AS day,
         bool_or(session_assignment.kind = 'event'::text AND session_assignment.event_name = 'Completed order'::text) AS converted
  FROM session_assignment
  GROUP BY session_assignment.instance_id, session_assignment.user_id, session_assignment.session_seq
), ud AS (
  SELECT event_stream.instance_id, event_stream.user_id, public.instance_day(event_stream.instance_id, event_stream.created_at) AS day,
         bool_or(event_stream.kind = 'event'::text AND event_stream.event_name = 'Completed order'::text) AS converted
  FROM event_stream
  GROUP BY event_stream.instance_id, event_stream.user_id, public.instance_day(event_stream.instance_id, event_stream.created_at)
)
SELECT cs.instance_id, cs.day, 'search_volume'::text AS metric_key, 'search'::text AS grain,
       NULL::numeric AS numerator, NULL::numeric AS denominator, count(*)::numeric AS value, count(*)::integer AS sample_size
  FROM cs GROUP BY cs.instance_id, cs.day
UNION ALL
SELECT cs.instance_id, cs.day, 'zero_result_searches'::text, 'search'::text,
       NULL::numeric, NULL::numeric, count(*) FILTER (WHERE cs.total_hits = 0)::numeric, count(*)::integer
  FROM cs GROUP BY cs.instance_id, cs.day
UNION ALL
SELECT cs.instance_id, cs.day, 'no_result_rate'::text, 'search'::text,
       count(*) FILTER (WHERE cs.total_hits = 0)::numeric, count(*)::numeric,
       count(*) FILTER (WHERE cs.total_hits = 0)::numeric / NULLIF(count(*), 0)::numeric, count(*)::integer
  FROM cs GROUP BY cs.instance_id, cs.day
UNION ALL
SELECT sc.instance_id, sc.day, 'search_ctr'::text, 'search'::text,
       count(*) FILTER (WHERE sc.total_hits > 0 AND sc.first_click_ts IS NOT NULL)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0 AND sc.first_click_ts IS NOT NULL)::numeric / NULLIF(count(*) FILTER (WHERE sc.total_hits > 0), 0)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0)::integer
  FROM sc GROUP BY sc.instance_id, sc.day
UNION ALL
SELECT sc.instance_id, sc.day, 'no_click_rate'::text, 'search'::text,
       count(*) FILTER (WHERE sc.total_hits > 0 AND sc.first_click_ts IS NULL)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0 AND sc.first_click_ts IS NULL)::numeric / NULLIF(count(*) FILTER (WHERE sc.total_hits > 0), 0)::numeric,
       count(*) FILTER (WHERE sc.total_hits > 0)::integer
  FROM sc GROUP BY sc.instance_id, sc.day
UNION ALL
SELECT sc.instance_id, sc.day, 'time_to_first_click_median'::text, 'search'::text,
       NULL::numeric, NULL::numeric,
       percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (EXTRACT(epoch FROM sc.first_click_ts - sc.search_ts)::double precision))::numeric,
       count(*)::integer
  FROM sc WHERE sc.first_click_ts IS NOT NULL GROUP BY sc.instance_id, sc.day
UNION ALL
SELECT clk.instance_id, clk.day, 'avg_click_position'::text, 'click'::text,
       sum(clk."position")::numeric, count(*)::numeric, avg(clk."position"), count(*)::integer
  FROM clk WHERE clk."position" IS NOT NULL GROUP BY clk.instance_id, clk.day
UNION ALL
SELECT clk.instance_id, clk.day, 'mrr'::text, 'click'::text,
       NULL::numeric, NULL::numeric, avg(1.0 / (clk."position" + 1)::numeric), count(*)::integer
  FROM clk WHERE clk."position" IS NOT NULL GROUP BY clk.instance_id, clk.day
UNION ALL
SELECT conv.instance_id, conv.day, 'cart_to_checkout'::text, 'event'::text,
       count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text)::numeric,
       count(*) FILTER (WHERE conv.event_name = ANY (ARRAY['Added to cart'::text, 'Added to cart from PLP'::text, 'Added to cart from PDP'::text]))::numeric,
       count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text)::numeric / NULLIF(count(*) FILTER (WHERE conv.event_name = ANY (ARRAY['Added to cart'::text, 'Added to cart from PLP'::text, 'Added to cart from PDP'::text])), 0)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT conv.instance_id, conv.day, 'checkout_to_purchase'::text, 'event'::text,
       (count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL) + count(*) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NULL))::numeric,
       count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text)::numeric,
       (count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL) + count(*) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NULL))::numeric / NULLIF(count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text), 0)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT vw.instance_id, vw.day, 'pdp_views'::text, 'event'::text,
       NULL::numeric, NULL::numeric, count(*)::numeric, count(*)::integer
  FROM vw GROUP BY vw.instance_id, vw.day
UNION ALL
SELECT COALESCE(v.instance_id, c.instance_id), COALESCE(v.day, c.day), 'click_to_pdp'::text, 'event'::text,
       COALESCE(v.views, 0)::numeric, COALESCE(c.clicks, 0)::numeric,
       COALESCE(v.views, 0)::numeric / NULLIF(c.clicks, 0)::numeric, NULL::integer
  FROM (SELECT vw.instance_id, vw.day, count(*) AS views FROM vw GROUP BY vw.instance_id, vw.day) v
  FULL JOIN (SELECT clk.instance_id, clk.day, count(*) AS clicks FROM clk GROUP BY clk.instance_id, clk.day) c
    ON c.instance_id = v.instance_id AND c.day = v.day
UNION ALL
SELECT COALESCE(a.instance_id, v.instance_id), COALESCE(a.day, v.day), 'pdp_to_cart'::text, 'event'::text,
       COALESCE(a.adds, 0)::numeric, COALESCE(v.views, 0)::numeric,
       COALESCE(a.adds, 0)::numeric / NULLIF(v.views, 0)::numeric, NULL::integer
  FROM (SELECT conv.instance_id, conv.day, count(*) FILTER (WHERE conv.event_name = ANY (ARRAY['Added to cart'::text, 'Added to cart from PLP'::text, 'Added to cart from PDP'::text])) AS adds FROM conv GROUP BY conv.instance_id, conv.day) a
  FULL JOIN (SELECT vw.instance_id, vw.day, count(*) AS views FROM vw GROUP BY vw.instance_id, vw.day) v
    ON v.instance_id = a.instance_id AND v.day = a.day
UNION ALL
SELECT COALESCE(s.instance_id, o.instance_id), COALESCE(s.day, o.day), 'search_to_purchase'::text, 'intent'::text,
       COALESCE(o.orders, 0::bigint)::numeric, COALESCE(s.searches, 0::bigint)::numeric,
       COALESCE(o.orders, 0::bigint)::numeric / NULLIF(s.searches, 0)::numeric, NULL::integer
  FROM (SELECT cs.instance_id, cs.day, count(*) AS searches FROM cs GROUP BY cs.instance_id, cs.day) s
  FULL JOIN (SELECT conv.instance_id, conv.day,
                    (count(DISTINCT conv.order_id) FILTER (WHERE conv.order_id IS NOT NULL) + count(*) FILTER (WHERE conv.order_id IS NULL)) AS orders FROM conv
             WHERE conv.event_name = 'Completed order'::text AND conv.query_uid IS NOT NULL
             GROUP BY conv.instance_id, conv.day) o ON o.instance_id = s.instance_id AND o.day = s.day
UNION ALL
SELECT sess.instance_id, sess.day, 'session_conversion'::text, 'session'::text,
       count(*) FILTER (WHERE sess.converted)::numeric, count(*)::numeric,
       count(*) FILTER (WHERE sess.converted)::numeric / NULLIF(count(*), 0)::numeric, count(*)::integer
  FROM sess GROUP BY sess.instance_id, sess.day
UNION ALL
SELECT ud.instance_id, ud.day, 'user_conversion'::text, 'user'::text,
       count(*) FILTER (WHERE ud.converted)::numeric, count(*)::numeric,
       count(*) FILTER (WHERE ud.converted)::numeric / NULLIF(count(*), 0)::numeric, count(*)::integer
  FROM ud GROUP BY ud.instance_id, ud.day
UNION ALL
SELECT so.instance_id, so.day, 'total_sales'::text, 'event'::text,
       NULL::numeric, NULL::numeric, COALESCE(sum(so.amount), 0)::numeric, count(*)::integer
  FROM so GROUP BY so.instance_id, so.day
UNION ALL
SELECT so.instance_id, so.day, 'orders'::text, 'event'::text,
       NULL::numeric, NULL::numeric, count(*)::numeric, NULL::integer
  FROM so GROUP BY so.instance_id, so.day
UNION ALL
SELECT so.instance_id, so.day, 'aov'::text, 'event'::text,
       COALESCE(sum(so.amount), 0)::numeric, NULLIF(count(*), 0)::numeric,
       COALESCE(sum(so.amount), 0)::numeric / NULLIF(count(*), 0)::numeric, NULL::integer
  FROM so GROUP BY so.instance_id, so.day
UNION ALL
SELECT so.instance_id, so.day, 'avg_items_per_order'::text, 'event'::text,
       COALESCE(sum(so.total_quantity), 0)::numeric, NULLIF(count(*), 0)::numeric,
       COALESCE(sum(so.total_quantity), 0)::numeric / NULLIF(count(*), 0)::numeric, NULL::integer
  FROM so GROUP BY so.instance_id, so.day
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
    ON u.instance_id = r.instance_id AND u.day = r.day;
