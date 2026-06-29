-- Conversion-Measurement Foundations (B1) — view-defined metric logic + refresh.
--
-- The METRIC LOGIC lives here as views (single source of truth, cheap to change);
-- refresh_metric_daily() materializes it into metric_daily (the fast, historical
-- snapshot). Change a view -> next refresh reflects it (re-backfill to restate
-- history). See docs/design/conversion-measurement-foundations.md.
--
-- Population note: a "committed search" = query_log with is_committed IS NOT
-- FALSE — i.e. results-page/Enter (true) AND pre-v0.9.0 unflagged rows (NULL).
-- Typeahead prefix probes (false) are EXCLUDED. Pre-v0.9.0 history therefore
-- still contains unflagged probes; read trend across the v0.9.0 boundary with
-- that caveat.

-- ── Activity stream (for sessionization) ────────────────────────────────────
-- Unified searches + events per identity. Only rows with a browser id can be
-- sessionized; committed searches whose user_id is still NULL (results-page
-- rows before the cookie-mirror lands) simply don't contribute to session/user
-- grains yet.
CREATE OR REPLACE VIEW public.event_stream AS
  SELECT instance_id, user_id, account_id, created_at,
         'search'::text AS kind, query_uid, NULL::text AS event_name
  FROM public.query_log
  WHERE user_id IS NOT NULL AND is_committed IS NOT FALSE
  UNION ALL
  SELECT instance_id, user_id, account_id, created_at,
         'event'::text AS kind, query_uid, event_name
  FROM public.analytics_event
  WHERE user_id IS NOT NULL;

COMMENT ON VIEW public.event_stream IS
  'Unified per-identity activity (committed searches + events) for sessionization. B1.';

-- ── Session assignment (30-min inactivity gap + calendar-day boundary) ───────
CREATE OR REPLACE VIEW public.session_assignment AS
  WITH ordered AS (
    SELECT instance_id, user_id, account_id, created_at, kind, event_name,
      CASE
        WHEN LAG(created_at) OVER w IS NULL
          OR created_at - LAG(created_at) OVER w > interval '30 minutes'
          OR created_at::date <> (LAG(created_at) OVER w)::date
        THEN 1 ELSE 0
      END AS new_session
    FROM public.event_stream
    WINDOW w AS (PARTITION BY instance_id, user_id ORDER BY created_at)
  )
  SELECT instance_id, user_id, account_id, created_at, kind, event_name,
    SUM(new_session) OVER (
      PARTITION BY instance_id, user_id ORDER BY created_at
      ROWS UNBOUNDED PRECEDING
    ) AS session_seq
  FROM ordered;

COMMENT ON VIEW public.session_assignment IS
  'Assigns a per-identity session_seq using a 30-min inactivity gap + day boundary (GA4-consistent). B1.';

-- ── The metric source (every KPI as a daily row) ────────────────────────────
-- Columns: instance_id, day, metric_key, grain, numerator, denominator, value,
-- sample_size. Rate metrics fill num/den (value = num/den); aggregates fill
-- value + sample_size.
CREATE OR REPLACE VIEW public.metric_daily_source AS
  WITH cs AS (   -- committed searches
    SELECT instance_id, created_at, created_at::date AS day, query_uid, total_hits
    FROM public.query_log
    WHERE is_committed IS NOT FALSE
  ),
  clk AS (       -- search-result clicks
    SELECT instance_id, created_at, created_at::date AS day, query_uid, position
    FROM public.analytics_event
    WHERE event_type = 'click'
  ),
  conv AS (      -- conversions
    SELECT instance_id, created_at::date AS day, event_name, query_uid
    FROM public.analytics_event
    WHERE event_type = 'conversion'
  ),
  sc AS (        -- per committed search w/ a queryUid: results? first-click latency?
    -- Attribution is by query_uid ALONE (Meili mints it uniquely per search, so a
    -- click carrying it provably came from that search). No created_at guard: the
    -- search's query_log row is written deferred (fire-and-forget after the
    -- response) while the click inserts immediately, so the click can timestamp
    -- BEFORE the search — a guard there would drop real clicks.
    SELECT cs.instance_id, cs.day, cs.total_hits, cs.created_at AS search_ts,
      ( SELECT MIN(c.created_at) FROM clk c
        WHERE c.instance_id = cs.instance_id
          AND c.query_uid = cs.query_uid ) AS first_click_ts
    FROM cs WHERE cs.query_uid IS NOT NULL
  ),
  sess AS (      -- per-session: did it convert?
    SELECT instance_id, user_id, session_seq, MIN(created_at)::date AS day,
      BOOL_OR(kind = 'event' AND event_name = 'Completed order') AS converted
    FROM public.session_assignment
    GROUP BY instance_id, user_id, session_seq
  ),
  ud AS (        -- per-user-day: active + converted (device tier)
    SELECT instance_id, user_id, created_at::date AS day,
      BOOL_OR(kind = 'event' AND event_name = 'Completed order') AS converted
    FROM public.event_stream
    GROUP BY instance_id, user_id, created_at::date
  )

  -- Findability (search grain) ----------------------------------------------
  SELECT instance_id, day, 'search_volume'::text AS metric_key, 'search'::text AS grain,
    NULL::numeric AS numerator, NULL::numeric AS denominator,
    COUNT(*)::numeric AS value, COUNT(*)::int AS sample_size
  FROM cs GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'zero_result_searches', 'search',
    NULL::numeric, NULL::numeric,
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
  SELECT instance_id, day, 'time_to_first_click_median', 'search',
    NULL::numeric, NULL::numeric,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_click_ts - search_ts)))::numeric,
    COUNT(*)::int
  FROM sc WHERE first_click_ts IS NOT NULL GROUP BY instance_id, day

  -- Findability (click grain) -----------------------------------------------
  UNION ALL
  SELECT instance_id, day, 'avg_click_position', 'click',
    SUM(position)::numeric, COUNT(*)::numeric, AVG(position)::numeric, COUNT(*)::int
  FROM clk WHERE position IS NOT NULL GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'mrr', 'click',
    NULL::numeric, NULL::numeric, AVG(1.0 / (position + 1))::numeric, COUNT(*)::int
  FROM clk WHERE position IS NOT NULL GROUP BY instance_id, day

  -- Conversion funnel (event grain) -----------------------------------------
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

  -- Search -> purchase (intent grain; cross-source per day) -----------------
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

  -- Conversion by grain (session / user, device tier) -----------------------
  UNION ALL
  SELECT instance_id, day, 'session_conversion', 'session',
    COUNT(*) FILTER (WHERE converted)::numeric, COUNT(*)::numeric,
    COUNT(*) FILTER (WHERE converted)::numeric / NULLIF(COUNT(*), 0), COUNT(*)::int
  FROM sess GROUP BY instance_id, day
  UNION ALL
  SELECT instance_id, day, 'user_conversion', 'user',
    COUNT(*) FILTER (WHERE converted)::numeric, COUNT(*)::numeric,
    COUNT(*) FILTER (WHERE converted)::numeric / NULLIF(COUNT(*), 0), COUNT(*)::int
  FROM ud GROUP BY instance_id, day;

COMMENT ON VIEW public.metric_daily_source IS
  'B1 KPI logic (single source of truth). Materialized into metric_daily by refresh_metric_daily(). Each row = one KPI for one (instance, day).';

-- ── Refresh: materialize the source view into the daily table ───────────────
-- p_day NULL = full rebuild (backfill); a date = just that day (nightly cron).
CREATE OR REPLACE FUNCTION public.refresh_metric_daily(p_day date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF p_day IS NULL THEN
    DELETE FROM public.metric_daily;
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

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260627000004',
  'B1 conversion-measurement: event_stream + session_assignment + metric_daily_source views; refresh_metric_daily() materializer'
)
ON CONFLICT (version) DO NOTHING;
