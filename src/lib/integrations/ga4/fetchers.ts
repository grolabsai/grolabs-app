/**
 * Server-side data fetchers for /dashboard/traffic.
 *
 * Each fetcher returns a typed shape designed to be rendered directly. The
 * UI (post-mockup) will consume these without any additional aggregation —
 * keeping aggregation in this layer makes the future agent panel's "show me
 * X" calls reuse the same code path as the rendering.
 *
 * RLS gates rows to the caller's instance, so the supabase client returned
 * by createClient() is enough — no service role here.
 */

import { createClient } from "@/lib/supabase/server";
import {
  refreshAccessToken,
  runRealtimeReport,
  Ga4ApiError,
  Ga4OAuthError,
} from "./client";
import {
  REALTIME_WINDOW_MINUTES,
  TIMESERIES_DAYS,
  TOP_CHANNELS_DEFAULT,
  TOP_EXIT_PAGES_DEFAULT,
  TOP_GEO_DEFAULT,
  TOP_LANDING_PAGES_DEFAULT,
} from "./constants";
import type {
  AlertMetric,
  AlertStatus,
  Ga4Alert,
  Ga4Config,
} from "./types";

// ── Connection / config ──────────────────────────────────────────────────────

export async function getGa4Config(
  instanceId: number,
): Promise<Ga4Config | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  const cfg = (
    data?.integrations_config as { ga4?: Ga4Config } | null | undefined
  )?.ga4;
  return cfg ?? null;
}

export async function isGa4Connected(instanceId: number): Promise<boolean> {
  const cfg = await getGa4Config(instanceId);
  return !!cfg?.property_id;
}

// ── Time-series ──────────────────────────────────────────────────────────────

export interface SessionTimeseriesPoint {
  date: string;
  sessions: number;
  users: number;
  engagement_rate: number;
  avg_session_duration_sec: number;
  views_per_session: number;
  rolling_avg_sessions: number; // 7-day trailing average
}

export async function getSessionTimeseries(
  instanceId: number,
  days: number = TIMESERIES_DAYS,
): Promise<SessionTimeseriesPoint[]> {
  const supabase = await createClient();
  // Pull `days + 6` so the leftmost rolling-avg points have 7 prior days.
  const { data } = await supabase
    .from("ga4_session_daily")
    .select(
      "date, sessions, users, engagement_rate, avg_session_duration_sec, views_per_session",
    )
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(days + 6);

  const rows = ((data ?? []) as Array<{
    date: string;
    sessions: number;
    users: number;
    engagement_rate: number;
    avg_session_duration_sec: number;
    views_per_session: number;
  }>)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Drop the trailing not-yet-finalized day(s) (current UTC day is all-zero
  // until GA4 processes it) so the lines don't cliff to zero at the right edge.
  while (rows.length > 1 && rows[rows.length - 1].sessions === 0) rows.pop();

  const out: SessionTimeseriesPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const window = rows.slice(Math.max(0, i - 6), i + 1);
    const avg =
      window.reduce((s, r) => s + r.sessions, 0) / Math.max(window.length, 1);
    out.push({
      date: rows[i].date,
      sessions: rows[i].sessions,
      users: rows[i].users,
      engagement_rate: Number(rows[i].engagement_rate),
      avg_session_duration_sec: Number(rows[i].avg_session_duration_sec),
      views_per_session: Number(rows[i].views_per_session),
      rolling_avg_sessions: avg,
    });
  }
  // Return only the trailing `days` for display (drops the warmup).
  return out.slice(-days);
}

// ── Audience summary (latest finalized day vs 7-day baseline) ─────────────────

export interface AudienceSummary {
  hasData: boolean;
  users: number;
  usersDeltaPct: number;
  newUsers: number;
  newUsersDeltaPct: number;
  returningUsers: number;
  returningUsersDeltaPct: number;
  sessions: number;
  sessionsDeltaPct: number;
  engagedSessions: number;
  nonEngagedSessions: number;
  engagementRate: number; // 0..1
  engagementDeltaPp: number; // signed percentage points
  avgSessionDurationSec: number;
  durationDeltaPct: number;
  viewsPerSession: number;
  viewsDeltaPct: number;
}

function pctDelta(observed: number, baseline: number): number {
  return baseline > 0 ? ((observed - baseline) / baseline) * 100 : 0;
}

/**
 * One row of headline audience metrics for the most-recent finalized day,
 * each with a delta versus the trailing 7-day average. Powers the two
 * Audience donuts and the per-session depth tile.
 */
export async function getAudienceSummary(
  instanceId: number,
): Promise<AudienceSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ga4_session_daily")
    .select(
      "date, sessions, users, new_users, returning_users, engaged_sessions, engagement_rate, avg_session_duration_sec, views_per_session",
    )
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(8);

  const rows = ((data ?? []) as Array<{
    date: string;
    sessions: number;
    users: number;
    new_users: number;
    returning_users: number;
    engaged_sessions: number;
    engagement_rate: number;
    avg_session_duration_sec: number;
    views_per_session: number;
  }>)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (rows.length === 0) {
    return {
      hasData: false,
      users: 0,
      usersDeltaPct: 0,
      newUsers: 0,
      newUsersDeltaPct: 0,
      returningUsers: 0,
      returningUsersDeltaPct: 0,
      sessions: 0,
      sessionsDeltaPct: 0,
      engagedSessions: 0,
      nonEngagedSessions: 0,
      engagementRate: 0,
      engagementDeltaPp: 0,
      avgSessionDurationSec: 0,
      durationDeltaPct: 0,
      viewsPerSession: 0,
      viewsDeltaPct: 0,
    };
  }

  // The current day (and any quiet trailing day) is all-zero — GA4 hasn't
  // finalized it yet — so anchoring the headline on the latest *row* makes every
  // metric read 0 with a -100% delta. Anchor instead on the most recent day that
  // actually has sessions; the days before it form the baseline.
  let obsIdx = rows.length - 1;
  while (obsIdx > 0 && rows[obsIdx].sessions === 0) obsIdx--;
  const observed = rows[obsIdx];
  const base = rows.slice(0, obsIdx);
  const avg = (sel: (r: (typeof rows)[number]) => number) =>
    base.length > 0 ? base.reduce((s, r) => s + Number(sel(r)), 0) / base.length : 0;

  const engagementRate = Number(observed.engagement_rate);
  const baseEr = avg((r) => Number(r.engagement_rate));

  return {
    hasData: true,
    users: observed.users,
    usersDeltaPct: pctDelta(observed.users, avg((r) => r.users)),
    newUsers: observed.new_users,
    newUsersDeltaPct: pctDelta(observed.new_users, avg((r) => r.new_users)),
    returningUsers: observed.returning_users,
    returningUsersDeltaPct: pctDelta(
      observed.returning_users,
      avg((r) => r.returning_users),
    ),
    sessions: observed.sessions,
    sessionsDeltaPct: pctDelta(observed.sessions, avg((r) => r.sessions)),
    engagedSessions: observed.engaged_sessions,
    nonEngagedSessions: Math.max(
      0,
      observed.sessions - observed.engaged_sessions,
    ),
    engagementRate,
    engagementDeltaPp: (engagementRate - baseEr) * 100,
    avgSessionDurationSec: Number(observed.avg_session_duration_sec),
    durationDeltaPct: pctDelta(
      Number(observed.avg_session_duration_sec),
      avg((r) => Number(r.avg_session_duration_sec)),
    ),
    viewsPerSession: Number(observed.views_per_session),
    viewsDeltaPct: pctDelta(
      Number(observed.views_per_session),
      avg((r) => Number(r.views_per_session)),
    ),
  };
}

// ── Device mix (latest finalized day) ────────────────────────────────────────

export interface DeviceMixRow {
  device: string;
  sessions: number;
  share: number; // 0..1
}

export async function getDeviceMix(
  instanceId: number,
): Promise<DeviceMixRow[]> {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("ga4_device_daily")
    .select("date")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return [];
  const observedDate = latest.date as string;

  const { data } = await supabase
    .from("ga4_device_daily")
    .select("device_category, sessions")
    .eq("instance_id", instanceId)
    .eq("date", observedDate);

  const agg = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    device_category: string;
    sessions: number;
  }>) {
    agg.set(r.device_category, (agg.get(r.device_category) ?? 0) + r.sessions);
  }
  const total = [...agg.values()].reduce((s, v) => s + v, 0);

  return [...agg.entries()]
    .map(([device, sessions]) => ({
      device,
      sessions,
      share: total > 0 ? sessions / total : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ── Channels ─────────────────────────────────────────────────────────────────

export interface ChannelMixRow {
  channel: string;
  sessions_today: number;
  sessions_baseline_avg: number;
  share_today: number; // 0..1
  share_baseline: number; // 0..1
  delta_share_pp: number; // signed percentage points
}

/**
 * Channel mix for the most-recent day vs the 7-day baseline.
 * Uses default_channel_grouping as the primary slice.
 */
export async function getTopChannels(
  instanceId: number,
  limit: number = TOP_CHANNELS_DEFAULT,
): Promise<ChannelMixRow[]> {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("ga4_traffic_daily")
    .select("date")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return [];
  const observedDate: string = latest.date;
  const start = new Date(`${observedDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const baselineStart = start.toISOString().slice(0, 10);

  const { data: today } = await supabase
    .from("ga4_traffic_daily")
    .select("default_channel_grouping, sessions")
    .eq("instance_id", instanceId)
    .eq("date", observedDate);

  const { data: base } = await supabase
    .from("ga4_traffic_daily")
    .select("default_channel_grouping, sessions")
    .eq("instance_id", instanceId)
    .gte("date", baselineStart)
    .lt("date", observedDate);

  const rowsToday = (today ?? []) as Array<{
    default_channel_grouping: string;
    sessions: number;
  }>;
  const rowsBase = (base ?? []) as Array<{
    default_channel_grouping: string;
    sessions: number;
  }>;

  const totalToday = rowsToday.reduce((s, r) => s + r.sessions, 0);
  const totalBase = rowsBase.reduce((s, r) => s + r.sessions, 0);
  const baseDays = 7;

  const aggToday = new Map<string, number>();
  for (const r of rowsToday) {
    aggToday.set(
      r.default_channel_grouping,
      (aggToday.get(r.default_channel_grouping) ?? 0) + r.sessions,
    );
  }
  const aggBase = new Map<string, number>();
  for (const r of rowsBase) {
    aggBase.set(
      r.default_channel_grouping,
      (aggBase.get(r.default_channel_grouping) ?? 0) + r.sessions,
    );
  }

  const channels = new Set([...aggToday.keys(), ...aggBase.keys()]);
  const out: ChannelMixRow[] = [];
  for (const ch of channels) {
    const sessionsToday = aggToday.get(ch) ?? 0;
    const sessionsBase = aggBase.get(ch) ?? 0;
    const shareToday = totalToday > 0 ? sessionsToday / totalToday : 0;
    const shareBase = totalBase > 0 ? sessionsBase / totalBase : 0;
    out.push({
      channel: ch,
      sessions_today: sessionsToday,
      sessions_baseline_avg: sessionsBase / baseDays,
      share_today: shareToday,
      share_baseline: shareBase,
      delta_share_pp: (shareToday - shareBase) * 100,
    });
  }

  out.sort((a, b) => b.sessions_today - a.sessions_today);
  return out.slice(0, limit);
}

// ── Pages ────────────────────────────────────────────────────────────────────

export interface PageMetricRow {
  page_path: string;
  value: number; // entrances or exits depending on which fetcher
  baseline_avg: number;
  delta_pct: number;
}

async function topPagesBy(
  instanceId: number,
  field: "entrances" | "exits",
  limit: number,
): Promise<PageMetricRow[]> {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("ga4_page_daily")
    .select("date")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return [];
  const observedDate = latest.date as string;
  const start = new Date(`${observedDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const baselineStart = start.toISOString().slice(0, 10);

  const { data: today } = await supabase
    .from("ga4_page_daily")
    .select(`page_path, ${field}`)
    .eq("instance_id", instanceId)
    .eq("date", observedDate)
    .order(field, { ascending: false })
    .limit(limit);

  const paths = (today ?? []).map(
    (r) => (r as Record<string, unknown>).page_path as string,
  );
  if (paths.length === 0) return [];

  const { data: base } = await supabase
    .from("ga4_page_daily")
    .select(`page_path, ${field}`)
    .eq("instance_id", instanceId)
    .gte("date", baselineStart)
    .lt("date", observedDate)
    .in("page_path", paths);

  const baseAgg = new Map<string, number>();
  for (const r of base ?? []) {
    const row = r as Record<string, unknown>;
    const p = row.page_path as string;
    const v = Number(row[field] ?? 0);
    baseAgg.set(p, (baseAgg.get(p) ?? 0) + v);
  }

  return (today ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const path = row.page_path as string;
    const value = Number(row[field] ?? 0);
    const baselineAvg = (baseAgg.get(path) ?? 0) / 7;
    const deltaPct =
      baselineAvg > 0 ? ((value - baselineAvg) / baselineAvg) * 100 : 0;
    return {
      page_path: path,
      value,
      baseline_avg: baselineAvg,
      delta_pct: deltaPct,
    };
  });
}

export async function getTopLandingPages(
  instanceId: number,
  limit: number = TOP_LANDING_PAGES_DEFAULT,
): Promise<PageMetricRow[]> {
  return topPagesBy(instanceId, "entrances", limit);
}

export async function getTopExitPages(
  instanceId: number,
  limit: number = TOP_EXIT_PAGES_DEFAULT,
): Promise<PageMetricRow[]> {
  return topPagesBy(instanceId, "exits", limit);
}

// ── Geo ──────────────────────────────────────────────────────────────────────

export interface GeoRow {
  country: string;
  sessions: number;
  users: number;
}

export async function getGeoTop(
  instanceId: number,
  limit: number = TOP_GEO_DEFAULT,
): Promise<GeoRow[]> {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("ga4_geo_daily")
    .select("date")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return [];
  const observedDate = latest.date as string;

  const { data } = await supabase
    .from("ga4_geo_daily")
    .select("country, sessions, users")
    .eq("instance_id", instanceId)
    .eq("date", observedDate);

  const agg = new Map<string, { sessions: number; users: number }>();
  for (const r of (data ?? []) as Array<{
    country: string;
    sessions: number;
    users: number;
  }>) {
    const cur = agg.get(r.country) ?? { sessions: 0, users: 0 };
    agg.set(r.country, {
      sessions: cur.sessions + r.sessions,
      users: cur.users + r.users,
    });
  }

  return [...agg.entries()]
    .map(([country, v]) => ({ country, sessions: v.sessions, users: v.users }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

// ── Alert tile values + inbox ────────────────────────────────────────────────

export interface AlertTileValue {
  metric: AlertMetric;
  current: number;
  baseline: number;
  delta: number; // percentage points for engagement_rate, percent for sessions
  status: AlertStatus | "ok";
}

/**
 * Read the latest finalized session row plus 7-day average to populate the
 * three alert tiles. Tile status: 'firing' if a current ga4_alert row exists,
 * otherwise 'ok'.
 */
export async function getAlertTiles(
  instanceId: number,
): Promise<AlertTileValue[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ga4_session_daily")
    .select("date, sessions, engagement_rate")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(8);
  const rows = ((data ?? []) as Array<{
    date: string;
    sessions: number;
    engagement_rate: number;
  }>)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const observed = rows[rows.length - 1];
  const baselineRows = rows.slice(0, -1);

  const baseSessions =
    baselineRows.length > 0
      ? baselineRows.reduce((s, r) => s + r.sessions, 0) / baselineRows.length
      : 0;
  const baseEr =
    baselineRows.length > 0
      ? baselineRows.reduce((s, r) => s + Number(r.engagement_rate), 0) /
        baselineRows.length
      : 0;

  const { data: alerts } = await supabase
    .from("ga4_alert")
    .select("metric, status")
    .eq("instance_id", instanceId)
    .eq("status", "firing");

  const firingMetrics = new Set<AlertMetric>(
    ((alerts ?? []) as Array<{ metric: AlertMetric; status: AlertStatus }>).map(
      (a) => a.metric,
    ),
  );

  const sessionsCur = observed?.sessions ?? 0;
  const sessionsDelta =
    baseSessions > 0 ? ((sessionsCur - baseSessions) / baseSessions) * 100 : 0;
  const erCur = Number(observed?.engagement_rate ?? 0);
  const erDelta = (erCur - baseEr) * 100; // pp

  return [
    {
      metric: "sessions",
      current: sessionsCur,
      baseline: baseSessions,
      delta: sessionsDelta,
      status: firingMetrics.has("sessions") ? "firing" : "ok",
    },
    {
      metric: "engagement_rate",
      current: erCur,
      baseline: baseEr,
      delta: erDelta,
      status: firingMetrics.has("engagement_rate") ? "firing" : "ok",
    },
    {
      metric: "traffic_share",
      current: 0,
      baseline: 0,
      delta: 0,
      status: firingMetrics.has("traffic_share") ? "firing" : "ok",
    },
  ];
}

export async function getActiveAlerts(
  instanceId: number,
): Promise<Ga4Alert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ga4_alert")
    .select("*")
    .eq("instance_id", instanceId)
    .in("status", ["firing", "acknowledged"])
    .order("fired_at", { ascending: false });
  return (data ?? []) as Ga4Alert[];
}

// ── Realtime ─────────────────────────────────────────────────────────────────

export interface RealtimeActiveUsers {
  ok: boolean;
  activeUsers: number | null;
  error?: string;
}

/**
 * Live call to GA4 Realtime API. Used by the right-now widget; degrade
 * gracefully on error per policy §7.
 */
export async function getRealtimeActiveUsers(
  instanceId: number,
): Promise<RealtimeActiveUsers> {
  const supabase = await createClient();
  const cfg = await getGa4Config(instanceId);
  if (!cfg?.property_id) {
    return { ok: false, activeUsers: null, error: "not_connected" };
  }

  try {
    const { data: refreshTok } = await supabase.rpc("ga4_get_refresh_token", {
      p_instance_id: instanceId,
    });
    if (!refreshTok || typeof refreshTok !== "string") {
      return { ok: false, activeUsers: null, error: "no_refresh_token" };
    }
    const { access_token } = await refreshAccessToken(refreshTok);
    const r = await runRealtimeReport({
      propertyId: cfg.property_id,
      accessToken: access_token,
      request: {
        metrics: [{ name: "activeUsers" }],
        minuteRanges: [
          { startMinutesAgo: REALTIME_WINDOW_MINUTES, endMinutesAgo: 0 },
        ],
      },
    });
    const value = Number(r.rows?.[0]?.metricValues?.[0]?.value ?? 0);
    return { ok: true, activeUsers: Number.isFinite(value) ? value : 0 };
  } catch (err) {
    const msg =
      err instanceof Ga4ApiError
        ? `api_${err.status}`
        : err instanceof Ga4OAuthError
          ? "oauth_error"
          : "unknown_error";
    return { ok: false, activeUsers: null, error: msg };
  }
}
