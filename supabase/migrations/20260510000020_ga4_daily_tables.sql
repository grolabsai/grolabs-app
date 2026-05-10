-- GA4 daily snapshot tables.
-- Per docs/policy/ga4-integration.md §3 (locked schema, hybrid storage).
--
-- One table per dimension grain. Composite primary keys give us idempotent
-- upserts on re-pull (we re-pull the trailing 3 days every poll because GA4
-- finalizes data 24-48h late).
--
-- All tables: instance_id bigint NOT NULL REFERENCES instance(instance_id),
-- RLS enabled with the standard instance_isolation_* policies via
-- current_instance_id().

-- ============================================================================
-- 1. ga4_session_daily — top-line metrics, one row per (instance, date)
-- ============================================================================
CREATE TABLE ga4_session_daily (
  instance_id              bigint      NOT NULL REFERENCES instance(instance_id),
  date                     date        NOT NULL,
  sessions                 int         NOT NULL DEFAULT 0,
  users                    int         NOT NULL DEFAULT 0,
  active_users             int         NOT NULL DEFAULT 0,
  new_users                int         NOT NULL DEFAULT 0,
  returning_users          int         NOT NULL DEFAULT 0,
  engaged_sessions         int         NOT NULL DEFAULT 0,
  engagement_rate          numeric(5,4) NOT NULL DEFAULT 0,
  avg_engagement_time_sec  numeric(10,2) NOT NULL DEFAULT 0,
  avg_session_duration_sec numeric(10,2) NOT NULL DEFAULT 0,
  views                    int         NOT NULL DEFAULT 0,
  views_per_session        numeric(8,2) NOT NULL DEFAULT 0,
  pulled_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, date)
);

CREATE INDEX idx_ga4_session_daily_instance_date_desc
  ON ga4_session_daily(instance_id, date DESC);

-- ============================================================================
-- 2. ga4_traffic_daily — source/medium/campaign grain
-- ============================================================================
CREATE TABLE ga4_traffic_daily (
  instance_id              bigint NOT NULL REFERENCES instance(instance_id),
  date                     date   NOT NULL,
  source                   text   NOT NULL DEFAULT '(direct)',
  medium                   text   NOT NULL DEFAULT '(none)',
  campaign                 text   NOT NULL DEFAULT '(not set)',
  default_channel_grouping text   NOT NULL DEFAULT '(other)',
  sessions                 int    NOT NULL DEFAULT 0,
  engaged_sessions         int    NOT NULL DEFAULT 0,
  users                    int    NOT NULL DEFAULT 0,
  pulled_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, date, source, medium, campaign, default_channel_grouping)
);

CREATE INDEX idx_ga4_traffic_daily_instance_date_desc
  ON ga4_traffic_daily(instance_id, date DESC);

-- ============================================================================
-- 3. ga4_page_daily — top landing/exit pages
-- ============================================================================
CREATE TABLE ga4_page_daily (
  instance_id             bigint NOT NULL REFERENCES instance(instance_id),
  date                    date   NOT NULL,
  page_path               text   NOT NULL,
  views                   int    NOT NULL DEFAULT 0,
  entrances               int    NOT NULL DEFAULT 0,
  exits                   int    NOT NULL DEFAULT 0,
  avg_engagement_time_sec numeric(10,2) NOT NULL DEFAULT 0,
  pulled_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, date, page_path)
);

CREATE INDEX idx_ga4_page_daily_instance_date_desc
  ON ga4_page_daily(instance_id, date DESC);

-- ============================================================================
-- 4. ga4_geo_daily — country/city/language grain
-- ============================================================================
CREATE TABLE ga4_geo_daily (
  instance_id bigint NOT NULL REFERENCES instance(instance_id),
  date        date   NOT NULL,
  country     text   NOT NULL DEFAULT '(not set)',
  city        text   NOT NULL DEFAULT '(not set)',
  language    text   NOT NULL DEFAULT '(not set)',
  sessions    int    NOT NULL DEFAULT 0,
  users       int    NOT NULL DEFAULT 0,
  pulled_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, date, country, city, language)
);

CREATE INDEX idx_ga4_geo_daily_instance_date_desc
  ON ga4_geo_daily(instance_id, date DESC);

-- ============================================================================
-- 5. ga4_device_daily — device/browser/OS/screen grain
-- ============================================================================
CREATE TABLE ga4_device_daily (
  instance_id       bigint NOT NULL REFERENCES instance(instance_id),
  date              date   NOT NULL,
  device_category   text   NOT NULL DEFAULT '(not set)',
  browser           text   NOT NULL DEFAULT '(not set)',
  operating_system  text   NOT NULL DEFAULT '(not set)',
  screen_resolution text   NOT NULL DEFAULT '(not set)',
  sessions          int    NOT NULL DEFAULT 0,
  users             int    NOT NULL DEFAULT 0,
  pulled_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, date, device_category, browser, operating_system, screen_resolution)
);

CREATE INDEX idx_ga4_device_daily_instance_date_desc
  ON ga4_device_daily(instance_id, date DESC);

-- ============================================================================
-- 6. RLS — instance_isolation pattern, identical to catalog/pricing tables
-- ============================================================================
DO $$
DECLARE
  ga4_tables text[] := ARRAY[
    'ga4_session_daily',
    'ga4_traffic_daily',
    'ga4_page_daily',
    'ga4_geo_daily',
    'ga4_device_daily'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY ga4_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_select ON %1$I FOR SELECT TO authenticated
        USING (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_insert ON %1$I FOR INSERT TO authenticated
        WITH CHECK (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_update ON %1$I FOR UPDATE TO authenticated
        USING (instance_id = current_instance_id())
        WITH CHECK (instance_id = current_instance_id())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY instance_isolation_%1$s_delete ON %1$I FOR DELETE TO authenticated
        USING (instance_id = current_instance_id())
    $f$, t);
  END LOOP;
END $$;

INSERT INTO scout_schema_version (version, description)
VALUES ('20260510000020', 'GA4: 5 daily snapshot tables (session/traffic/page/geo/device) + instance_isolation RLS');
