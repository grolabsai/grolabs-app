/**
 * GA4 polling pipeline. Per docs/policy/ga4-integration.md §5.
 *
 * For each instance with active credentials:
 *   1. Refresh access token
 *   2. For each of the trailing N days, run 5 reports and upsert into
 *      ga4_session_daily / ga4_traffic_daily / ga4_page_daily /
 *      ga4_geo_daily / ga4_device_daily.
 *   3. Update integrations_config.ga4.last_pull_*
 *   4. Anomaly detection runs separately (anomaly.ts) — caller orchestrates.
 *
 * All upserts are idempotent (composite PK). Re-pulls overwrite.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  refreshAccessToken,
  runReport,
  Ga4ApiError,
  Ga4OAuthError,
  type RunReportResponse,
} from "./client";
import { POLL_TRAILING_DAYS, TOP_PAGES_LIMIT } from "./constants";
import type {
  Ga4DeviceDailyRow,
  Ga4GeoDailyRow,
  Ga4PageDailyRow,
  Ga4SessionDailyRow,
  Ga4TrafficDailyRow,
  PullResult,
} from "./types";

// ── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBack(n: number): string[] {
  const today = new Date();
  // Anchor to UTC midnight to avoid TZ wobble across calls.
  today.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = n; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

// ── Row parsers ──────────────────────────────────────────────────────────────

function num(s: string | undefined): number {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rows(r: RunReportResponse) {
  return r.rows ?? [];
}

// Each parser expects metrics in the order requested below; dimensions live in
// dimensionValues by request order. Defensive defaults guard against null
// rows from GA4 (rare but possible for new properties).

function parseSessionRow(
  instanceId: number,
  date: string,
  r: RunReportResponse,
): Ga4SessionDailyRow {
  const row = r.rows?.[0];
  const m = (i: number) => num(row?.metricValues?.[i]?.value);
  const sessions = m(0);
  return {
    instance_id: instanceId,
    date,
    sessions,
    users: m(1),
    active_users: m(2),
    new_users: m(3),
    // GA4 doesn't expose a returningUsers metric directly; derive from
    // totalUsers - newUsers (clamped at 0).
    returning_users: Math.max(0, m(1) - m(3)),
    engaged_sessions: m(4),
    engagement_rate: m(5),
    // m(6) is raw userEngagementDuration (total seconds across the day);
    // the stored column is the per-session average, so divide by sessions.
    avg_engagement_time_sec: sessions > 0 ? m(6) / sessions : 0,
    avg_session_duration_sec: m(7),
    views: m(8),
    views_per_session: sessions > 0 ? m(8) / sessions : 0,
  };
}

function parseTrafficRows(
  instanceId: number,
  date: string,
  r: RunReportResponse,
): Ga4TrafficDailyRow[] {
  return rows(r).map((row) => {
    const dv = (i: number) => row.dimensionValues?.[i]?.value ?? "";
    const mv = (i: number) => num(row.metricValues?.[i]?.value);
    return {
      instance_id: instanceId,
      date,
      source: dv(0) || "(direct)",
      medium: dv(1) || "(none)",
      campaign: dv(2) || "(not set)",
      default_channel_grouping: dv(3) || "(other)",
      sessions: mv(0),
      engaged_sessions: mv(1),
      users: mv(2),
    };
  });
}

function parsePageRows(
  instanceId: number,
  date: string,
  r: RunReportResponse,
): Ga4PageDailyRow[] {
  return rows(r).map((row) => {
    const path = row.dimensionValues?.[0]?.value ?? "/";
    const mv = (i: number) => num(row.metricValues?.[i]?.value);
    return {
      instance_id: instanceId,
      date,
      page_path: path,
      views: mv(0),
      entrances: mv(1),
      exits: mv(2),
      avg_engagement_time_sec: mv(3),
    };
  });
}

function parseGeoRows(
  instanceId: number,
  date: string,
  r: RunReportResponse,
): Ga4GeoDailyRow[] {
  return rows(r).map((row) => {
    const dv = (i: number) => row.dimensionValues?.[i]?.value ?? "";
    const mv = (i: number) => num(row.metricValues?.[i]?.value);
    return {
      instance_id: instanceId,
      date,
      country: dv(0) || "(not set)",
      city: dv(1) || "(not set)",
      language: dv(2) || "(not set)",
      sessions: mv(0),
      users: mv(1),
    };
  });
}

function parseDeviceRows(
  instanceId: number,
  date: string,
  r: RunReportResponse,
): Ga4DeviceDailyRow[] {
  return rows(r).map((row) => {
    const dv = (i: number) => row.dimensionValues?.[i]?.value ?? "";
    const mv = (i: number) => num(row.metricValues?.[i]?.value);
    return {
      instance_id: instanceId,
      date,
      device_category: dv(0) || "(not set)",
      browser: dv(1) || "(not set)",
      operating_system: dv(2) || "(not set)",
      screen_resolution: dv(3) || "(not set)",
      sessions: mv(0),
      users: mv(1),
    };
  });
}

// ── Per-day fetch ────────────────────────────────────────────────────────────

interface DayPayload {
  session: Ga4SessionDailyRow;
  traffic: Ga4TrafficDailyRow[];
  pages: Ga4PageDailyRow[];
  geo: Ga4GeoDailyRow[];
  device: Ga4DeviceDailyRow[];
}

async function fetchDay(args: {
  propertyId: string;
  accessToken: string;
  instanceId: number;
  date: string;
}): Promise<DayPayload> {
  const { propertyId, accessToken, instanceId, date } = args;
  const dateRanges = [{ startDate: date, endDate: date }];

  const sessionReq = runReport({
    propertyId,
    accessToken,
    request: {
      dateRanges,
      dimensions: [],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "engagedSessions" },
        { name: "engagementRate" },
        // "Average engagement time per session" is a *calculated* GA4 metric, not
        // a raw API metric — requesting it by that name returns HTTP 400 and aborts
        // the whole pull. Pull the raw userEngagementDuration (total seconds) and
        // divide by sessions in parseSessionRow to get the per-session average.
        { name: "userEngagementDuration" },
        { name: "averageSessionDuration" },
        { name: "screenPageViews" },
      ],
    },
  });

  const trafficReq = runReport({
    propertyId,
    accessToken,
    request: {
      dateRanges,
      dimensions: [
        { name: "sessionSource" },
        { name: "sessionMedium" },
        { name: "sessionCampaignName" },
        { name: "sessionDefaultChannelGroup" },
      ],
      metrics: [
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "totalUsers" },
      ],
      keepEmptyRows: false,
    },
  });

  const pagesReq = runReport({
    propertyId,
    accessToken,
    request: {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "entrances" },
        { name: "exits" },
        { name: "userEngagementDuration" },
      ],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: TOP_PAGES_LIMIT,
    },
  });

  const geoReq = runReport({
    propertyId,
    accessToken,
    request: {
      dateRanges,
      dimensions: [
        { name: "country" },
        { name: "city" },
        { name: "language" },
      ],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 200,
    },
  });

  const deviceReq = runReport({
    propertyId,
    accessToken,
    request: {
      dateRanges,
      dimensions: [
        { name: "deviceCategory" },
        { name: "browser" },
        { name: "operatingSystem" },
        { name: "screenResolution" },
      ],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 200,
    },
  });

  const [sessionR, trafficR, pagesR, geoR, deviceR] = await Promise.all([
    sessionReq,
    trafficReq,
    pagesReq,
    geoReq,
    deviceReq,
  ]);

  return {
    session: parseSessionRow(instanceId, date, sessionR),
    traffic: parseTrafficRows(instanceId, date, trafficR),
    pages: parsePageRows(instanceId, date, pagesR),
    geo: parseGeoRows(instanceId, date, geoR),
    device: parseDeviceRows(instanceId, date, deviceR),
  };
}

// ── Upserts ──────────────────────────────────────────────────────────────────

// Re-pulls always overwrite. The composite PK on each table makes upsert
// trivial — we just specify onConflict and Supabase merges.

async function upsertSession(
  supabase: SupabaseClient,
  rows: Ga4SessionDailyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("ga4_session_daily")
    .upsert(rows, { onConflict: "instance_id,date" });
  if (error) throw error;
}

async function upsertTraffic(
  supabase: SupabaseClient,
  rows: Ga4TrafficDailyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("ga4_traffic_daily").upsert(rows, {
    onConflict:
      "instance_id,date,source,medium,campaign,default_channel_grouping",
  });
  if (error) throw error;
}

async function upsertPages(
  supabase: SupabaseClient,
  rows: Ga4PageDailyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("ga4_page_daily")
    .upsert(rows, { onConflict: "instance_id,date,page_path" });
  if (error) throw error;
}

async function upsertGeo(
  supabase: SupabaseClient,
  rows: Ga4GeoDailyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("ga4_geo_daily")
    .upsert(rows, { onConflict: "instance_id,date,country,city,language" });
  if (error) throw error;
}

async function upsertDevice(
  supabase: SupabaseClient,
  rows: Ga4DeviceDailyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("ga4_device_daily").upsert(rows, {
    onConflict:
      "instance_id,date,device_category,browser,operating_system,screen_resolution",
  });
  if (error) throw error;
}

// ── Public entrypoints ───────────────────────────────────────────────────────

/**
 * Pull the trailing N days (POLL_TRAILING_DAYS by default) for one instance.
 * Caller is responsible for orchestration (cron route or pull-now action).
 *
 * Records the result via ga4_record_pull. Always returns a PullResult — never
 * throws past the entry point. Callers that want to fail loudly should check
 * `result.ok`.
 */
export async function pullForInstance(args: {
  instanceId: number;
  propertyId: string;
  trailingDays?: number;
}): Promise<PullResult> {
  const { instanceId, propertyId } = args;
  const trailingDays = args.trailingDays ?? POLL_TRAILING_DAYS;

  const supabase = createServiceRoleClient();
  const start = Date.now();
  const counts = { session: 0, traffic: 0, page: 0, geo: 0, device: 0 };

  try {
    const { data: refreshTok, error: tokErr } = await supabase.rpc(
      "ga4_get_refresh_token",
      { p_instance_id: instanceId },
    );
    if (tokErr || !refreshTok || typeof refreshTok !== "string") {
      throw new Ga4OAuthError(
        `No refresh token for instance ${instanceId}: ${tokErr?.message ?? "missing"}`,
      );
    }
    const { access_token } = await refreshAccessToken(refreshTok);

    const dates = daysBack(trailingDays);
    for (const date of dates) {
      const day = await fetchDay({
        propertyId,
        accessToken: access_token,
        instanceId,
        date,
      });

      // Session row may be all-zero for a quiet day — still upsert so the
      // timeline has no gaps (test case in policy §9).
      await upsertSession(supabase, [day.session]);
      counts.session += 1;

      await upsertTraffic(supabase, day.traffic);
      counts.traffic += day.traffic.length;

      await upsertPages(supabase, day.pages);
      counts.page += day.pages.length;

      await upsertGeo(supabase, day.geo);
      counts.geo += day.geo.length;

      await upsertDevice(supabase, day.device);
      counts.device += day.device.length;
    }

    const latency = Date.now() - start;
    await supabase.rpc("ga4_record_pull", {
      p_instance_id: instanceId,
      p_status: "ok",
      p_latency_ms: latency,
      p_error: null,
    });

    return {
      instanceId,
      ok: true,
      latencyMs: latency,
      rowsBySurface: counts,
    };
  } catch (err) {
    const latency = Date.now() - start;
    const message =
      err instanceof Ga4ApiError
        ? `${err.message}`
        : err instanceof Ga4OAuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : "unknown error";

    try {
      await supabase.rpc("ga4_record_pull", {
        p_instance_id: instanceId,
        p_status: "error",
        p_latency_ms: latency,
        p_error: message,
      });
    } catch {
      // best-effort — don't mask the original error
    }

    return {
      instanceId,
      ok: false,
      latencyMs: latency,
      error: message,
      rowsBySurface: counts,
    };
  }
}

/**
 * Iterate every instance with a connected GA4 property and pull. Used by the
 * Vercel Cron entrypoint. Errors per-instance are isolated.
 */
export async function pullAllInstances(): Promise<PullResult[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("ga4_list_active_instances");
  if (error) {
    console.error("[ga4 poll] failed to list active instances", error.message);
    return [];
  }
  const list = (data ?? []) as Array<{
    instance_id: number;
    property_id: string;
  }>;

  const results: PullResult[] = [];
  for (const row of list) {
    if (!row.property_id) continue;
    const r = await pullForInstance({
      instanceId: row.instance_id,
      propertyId: row.property_id,
    });
    results.push(r);
  }
  return results;
}
