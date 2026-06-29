-- Conversion-Measurement Foundations (B1) — order value + sales KPIs.
--
-- Unblocks the dashboard's Sales row: events carried no monetary amount, so
-- total_sales / aov / avg_items_per_order were uncomputable (METRICS marked
-- them needs_instrumentation). This adds line value + quantity to analytics_event
-- and four sales metrics to metric_daily_source.
--
-- value    = the line's monetary subtotal (WC get_total()); per Completed-order line.
-- quantity = units in that line (WC get_quantity()).
-- Sales metrics group by order_id (now present) to get per-order rollups.

ALTER TABLE public.analytics_event
  ADD COLUMN IF NOT EXISTS value    numeric  NULL,
  ADD COLUMN IF NOT EXISTS quantity smallint NULL;

COMMENT ON COLUMN public.analytics_event.value IS
  'Monetary subtotal of the line (WC get_total()), on Completed-order (and optionally checkout/add) events. NULL when not a value-bearing event. B1 sales KPIs.';
COMMENT ON COLUMN public.analytics_event.quantity IS
  'Units in the line (WC get_quantity()). NULL when not applicable. Feeds avg_items_per_order.';

-- Re-create the metric source view with the conv CTE carrying value/quantity/order_id,
-- and four new sales metrics. Same output columns → CREATE OR REPLACE is safe.
CREATE OR REPLACE VIEW public.metric_daily_source AS
  WITH cs AS (
    SELECT instance_id, created_at, created_at::date AS day, query_uid, total_hits
    FROM public.query_log WHERE is_committed IS NOT FALSE
  ),
  clk AS (
    SELECT instance_id, created_at, created_at::date AS day, query_uid, position
    FROM public.analytics_event WHERE event_type = 'click'
  ),
  conv AS (
    SELECT instance_id, created_at::date AS day, event_name, query_uid, value, quantity, order_id
    FROM public.analytics_event WHERE event_type = 'conversion'
  ),
  sc AS (
    SELECT cs.instance_id, cs.day, cs.total_hits, cs.created_at AS search_ts,
      ( SELECT MIN(c.created_at) FROM clk c
        WHERE c.instance_id = cs.instance_id AND c.query_uid = cs.query_uid ) AS first_click_ts
    FROM cs WHERE cs.query_uid IS NOT NULL
  ),
  sess AS (
    SELECT instance_id, user_id, session_seq, MIN(created_at)::date AS day,
      BOOL_OR(kind = 'event' AND event_name = 'Completed order') AS converted
    FROM public.session_assignment GROUP BY instance_id, user_id, session_seq
  ),
  ud AS (
    SELECT instance_id, user_id, created_at::date AS day,
      BOOL_OR(kind = 'event' AND event_name = 'Completed order') AS converted
    FROM public.event_stream GROUP BY instance_id, user_id, created_at::date
  )
  SELECT instance_id, day, 'search_volume'::text AS metric_key, 'search'::text AS grain,
    NULL::numeric AS numerator, NULL::numeric AS denominator,
    COUNT(*)::numeric AS value, COUNT(*)::int AS sample_size
  FROM cs GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'zero_result_searches', 'search', NULL::numeric, NULL::numeric,
    COUNT(*) FILTER (WHERE total_hits = 0)::numeric, COUNT(*)::int
  FROM cs GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'no_result_rate', 'search',
    COUNT(*) FILTER (WHERE total_hits = 0)::numeric, COUNT(*)::numeric,
    COUNT(*) FILTER (WHERE total_hits = 0)::numeric / NULLIF(COUNT(*), 0), COUNT(*)::int
  FROM cs GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'search_ctr', 'search',
    COUNT(*) FILTER (WHERE total_hits > 0 AND first_click_ts IS NOT NULL)::numeric,
    COUNT(*) FILTER (WHERE total_hits > 0)::numeric,
    COUNT(*) FILTER (WHERE total_hits > 0 AND first_click_ts IS NOT NULL)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE total_hits > 0), 0),
    COUNT(*) FILTER (WHERE total_hits > 0)::int
  FROM sc GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'no_click_rate', 'search',
    COUNT(*) FILTER (WHERE total_hits > 0 AND first_click_ts IS NULL)::numeric,
    COUNT(*) FILTER (WHERE total_hits > 0)::numeric,
    COUNT(*) FILTER (WHERE total_hits > 0 AND first_click_ts IS NULL)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE total_hits > 0), 0),
    COUNT(*) FILTER (WHERE total_hits > 0)::int
  FROM sc GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'time_to_first_click_median', 'search', NULL::numeric, NULL::numeric,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_click_ts - search_ts)))::numeric,
    COUNT(*)::int
  FROM sc WHERE first_click_ts IS NOT NULL GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'avg_click_position', 'click',
    SUM(position)::numeric, COUNT(*)::numeric, AVG(position)::numeric, COUNT(*)::int
  FROM clk WHERE position IS NOT NULL GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'mrr', 'click', NULL::numeric, NULL::numeric,
    AVG(1.0 / (position + 1))::numeric, COUNT(*)::int
  FROM clk WHERE position IS NOT NULL GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'cart_to_checkout', 'event',
    COUNT(*) FILTER (WHERE event_name = 'Proceeded to check out')::numeric,
    COUNT(*) FILTER (WHERE event_name IN ('Added to cart from PLP', 'Added to cart from PDP'))::numeric,
    COUNT(*) FILTER (WHERE event_name = 'Proceeded to check out')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event_name IN ('Added to cart from PLP', 'Added to cart from PDP')), 0),
    NULL::int
  FROM conv GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'checkout_to_purchase', 'event',
    COUNT(*) FILTER (WHERE event_name = 'Completed order')::numeric,
    COUNT(*) FILTER (WHERE event_name = 'Proceeded to check out')::numeric,
    COUNT(*) FILTER (WHERE event_name = 'Completed order')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE event_name = 'Proceeded to check out'), 0),
    NULL::int
  FROM conv GROUP BY instance_id, day
  UNION ALL
  SELECT COALESCE(s.instance_id, o.instance_id), COALESCE(s.day, o.day),
    'search_to_purchase', 'intent',
    COALESCE(o.orders, 0)::numeric, COALESCE(s.searches, 0)::numeric,
    COALESCE(o.orders, 0)::numeric / NULLIF(s.searches, 0), NULL::int
  FROM (SELECT instance_id, day, COUNT(*) AS searches FROM cs GROUP BY 1, 2) s
  FULL JOIN (
    SELECT instance_id, day, COUNT(*) AS orders FROM conv
    WHERE event_name = 'Completed order' AND query_uid IS NOT NULL GROUP BY 1, 2
  ) o ON o.instance_id = s.instance_id AND o.day = s.day
  UNION ALL
  SELECT instance_id, day, 'session_conversion', 'session',
    COUNT(*) FILTER (WHERE converted)::numeric, COUNT(*)::numeric,
    COUNT(*) FILTER (WHERE converted)::numeric / NULLIF(COUNT(*), 0), COUNT(*)::int
  FROM sess GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'user_conversion', 'user',
    COUNT(*) FILTER (WHERE converted)::numeric, COUNT(*)::numeric,
    COUNT(*) FILTER (WHERE converted)::numeric / NULLIF(COUNT(*), 0), COUNT(*)::int
  FROM ud GROUP BY instance_id, day
  -- ── Sales (event grain · revenue) ───────────────────────────────────────
  UNION ALL
  SELECT instance_id, day, 'total_sales', 'event', NULL::numeric, NULL::numeric,
    COALESCE(SUM(value) FILTER (WHERE event_name = 'Completed order'), 0)::numeric,
    COUNT(*) FILTER (WHERE event_name = 'Completed order')::int
  FROM conv GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'orders', 'event', NULL::numeric, NULL::numeric,
    COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'Completed order' AND order_id IS NOT NULL)::numeric,
    NULL::int
  FROM conv GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'aov', 'event',
    COALESCE(SUM(value) FILTER (WHERE event_name = 'Completed order'), 0)::numeric,
    NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'Completed order' AND order_id IS NOT NULL), 0)::numeric,
    COALESCE(SUM(value) FILTER (WHERE event_name = 'Completed order'), 0)::numeric
      / NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'Completed order' AND order_id IS NOT NULL), 0),
    NULL::int
  FROM conv GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'avg_items_per_order', 'event',
    COALESCE(SUM(quantity) FILTER (WHERE event_name = 'Completed order'), 0)::numeric,
    NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'Completed order' AND order_id IS NOT NULL), 0)::numeric,
    COALESCE(SUM(quantity) FILTER (WHERE event_name = 'Completed order'), 0)::numeric
      / NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'Completed order' AND order_id IS NOT NULL), 0),
    NULL::int
  FROM conv GROUP BY instance_id, day;

COMMENT ON VIEW public.metric_daily_source IS
  'B1 KPI logic (single source of truth). Materialized into metric_daily by refresh_metric_daily(). Each row = one KPI for one (instance, day). Includes sales KPIs (total_sales/orders/aov/avg_items_per_order) from order value.';

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000005',
  'B1 conversion-measurement: analytics_event value+quantity; sales KPIs (total_sales/orders/aov/avg_items_per_order) in metric_daily_source'
)
ON CONFLICT (version) DO NOTHING;
