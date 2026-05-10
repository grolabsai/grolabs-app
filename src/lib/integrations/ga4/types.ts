/**
 * Type surface for the GA4 integration. Per docs/policy/ga4-integration.md.
 */

// ── Alert state ──────────────────────────────────────────────────────────────

export type AlertMetric = "sessions" | "engagement_rate" | "traffic_share";
export type AlertStatus = "firing" | "acknowledged" | "cleared";

export interface Ga4Alert {
  alert_id: number;
  instance_id: number;
  metric: AlertMetric;
  dimension_key: string | null;
  baseline_value: number;
  observed_value: number;
  delta_pct: number;
  status: AlertStatus;
  fired_at: string;
  acknowledged_at: string | null;
  cleared_at: string | null;
}

// ── Daily-row shapes (DB) ────────────────────────────────────────────────────

export interface Ga4SessionDailyRow {
  instance_id: number;
  date: string; // YYYY-MM-DD
  sessions: number;
  users: number;
  active_users: number;
  new_users: number;
  returning_users: number;
  engaged_sessions: number;
  engagement_rate: number;
  avg_engagement_time_sec: number;
  avg_session_duration_sec: number;
  views: number;
  views_per_session: number;
  pulled_at?: string;
}

export interface Ga4TrafficDailyRow {
  instance_id: number;
  date: string;
  source: string;
  medium: string;
  campaign: string;
  default_channel_grouping: string;
  sessions: number;
  engaged_sessions: number;
  users: number;
  pulled_at?: string;
}

export interface Ga4PageDailyRow {
  instance_id: number;
  date: string;
  page_path: string;
  views: number;
  entrances: number;
  exits: number;
  avg_engagement_time_sec: number;
  pulled_at?: string;
}

export interface Ga4GeoDailyRow {
  instance_id: number;
  date: string;
  country: string;
  city: string;
  language: string;
  sessions: number;
  users: number;
  pulled_at?: string;
}

export interface Ga4DeviceDailyRow {
  instance_id: number;
  date: string;
  device_category: string;
  browser: string;
  operating_system: string;
  screen_resolution: string;
  sessions: number;
  users: number;
  pulled_at?: string;
}

// ── Public configuration sub-key (instance.integrations_config.ga4) ──────────

export interface Ga4Config {
  property_id?: string;
  oauth_account_email?: string;
  connected_at?: string;
  last_pull_at?: string;
  last_pull_status?: "ok" | "error";
  last_pull_error?: string;
  last_pull_latency_ms?: number;
}

// ── Pull / poll outputs ──────────────────────────────────────────────────────

export interface PullResult {
  instanceId: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
  rowsBySurface: {
    session: number;
    traffic: number;
    page: number;
    geo: number;
    device: number;
  };
}
