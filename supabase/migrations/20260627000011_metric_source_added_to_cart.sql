-- Recreate metric_daily_source: cart_to_checkout denominator now counts the
-- single 'Added to cart' event (kept tolerant of the two legacy names through
-- the backfill). (Superseded by 20260627000013, which adds the PDP-view metrics.)
create or replace view public.metric_daily_source as
WITH cs AS (
  SELECT query_log.instance_id, query_log.created_at, query_log.created_at::date AS day,
         query_log.query_uid, query_log.total_hits
  FROM query_log WHERE query_log.is_committed IS NOT FALSE
), clk AS (
  SELECT analytics_event.instance_id, analytics_event.created_at, analytics_event.created_at::date AS day,
         analytics_event.query_uid, analytics_event."position"
  FROM analytics_event WHERE analytics_event.event_type = 'click'::text
), conv AS (
  SELECT analytics_event.instance_id, analytics_event.created_at::date AS day, analytics_event.event_name,
         analytics_event.query_uid, analytics_event.value, analytics_event.quantity, analytics_event.order_id
  FROM analytics_event WHERE analytics_event.event_type = 'conversion'::text
), sc AS (
  SELECT cs.instance_id, cs.day, cs.total_hits, cs.created_at AS search_ts,
         (SELECT min(c.created_at) FROM clk c WHERE c.instance_id = cs.instance_id AND c.query_uid = cs.query_uid) AS first_click_ts
  FROM cs WHERE cs.query_uid IS NOT NULL
), sess AS (
  SELECT session_assignment.instance_id, session_assignment.user_id, session_assignment.session_seq,
         min(session_assignment.created_at)::date AS day,
         bool_or(session_assignment.kind = 'event'::text AND session_assignment.event_name = 'Completed order'::text) AS converted
  FROM session_assignment
  GROUP BY session_assignment.instance_id, session_assignment.user_id, session_assignment.session_seq
), ud AS (
  SELECT event_stream.instance_id, event_stream.user_id, event_stream.created_at::date AS day,
         bool_or(event_stream.kind = 'event'::text AND event_stream.event_name = 'Completed order'::text) AS converted
  FROM event_stream
  GROUP BY event_stream.instance_id, event_stream.user_id, (event_stream.created_at::date)
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
       count(*) FILTER (WHERE conv.event_name = 'Completed order'::text)::numeric,
       count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text)::numeric,
       count(*) FILTER (WHERE conv.event_name = 'Completed order'::text)::numeric / NULLIF(count(*) FILTER (WHERE conv.event_name = 'Proceeded to check out'::text), 0)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT COALESCE(s.instance_id, o.instance_id), COALESCE(s.day, o.day), 'search_to_purchase'::text, 'intent'::text,
       COALESCE(o.orders, 0::bigint)::numeric, COALESCE(s.searches, 0::bigint)::numeric,
       COALESCE(o.orders, 0::bigint)::numeric / NULLIF(s.searches, 0)::numeric, NULL::integer
  FROM (SELECT cs.instance_id, cs.day, count(*) AS searches FROM cs GROUP BY cs.instance_id, cs.day) s
  FULL JOIN (SELECT conv.instance_id, conv.day, count(*) AS orders FROM conv
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
SELECT conv.instance_id, conv.day, 'total_sales'::text, 'event'::text,
       NULL::numeric, NULL::numeric,
       COALESCE(sum(conv.value) FILTER (WHERE conv.event_name = 'Completed order'::text), 0::numeric),
       count(*) FILTER (WHERE conv.event_name = 'Completed order'::text)::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT conv.instance_id, conv.day, 'orders'::text, 'event'::text,
       NULL::numeric, NULL::numeric,
       count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT conv.instance_id, conv.day, 'aov'::text, 'event'::text,
       COALESCE(sum(conv.value) FILTER (WHERE conv.event_name = 'Completed order'::text), 0::numeric),
       NULLIF(count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL), 0)::numeric,
       COALESCE(sum(conv.value) FILTER (WHERE conv.event_name = 'Completed order'::text), 0::numeric) / NULLIF(count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL), 0)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day
UNION ALL
SELECT conv.instance_id, conv.day, 'avg_items_per_order'::text, 'event'::text,
       COALESCE(sum(conv.quantity) FILTER (WHERE conv.event_name = 'Completed order'::text), 0::bigint)::numeric,
       NULLIF(count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL), 0)::numeric,
       COALESCE(sum(conv.quantity) FILTER (WHERE conv.event_name = 'Completed order'::text), 0::bigint)::numeric / NULLIF(count(DISTINCT conv.order_id) FILTER (WHERE conv.event_name = 'Completed order'::text AND conv.order_id IS NOT NULL), 0)::numeric,
       NULL::integer
  FROM conv GROUP BY conv.instance_id, conv.day;
