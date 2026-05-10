/**
 * Anomaly detection for the top-3 traffic-health metrics.
 * Per docs/policy/ga4-integration.md §6.
 *
 * Runs after polling. For each instance with finalized data:
 *   - Sessions ±15% vs 7-day rolling average → 'sessions' alert
 *   - Engagement Rate −10pp absolute drop      → 'engagement_rate' alert
 *   - Source/Medium share shift > 20pp         → 'traffic_share' alert per pair
 *
 * Lifecycle: dedupe by (instance_id, metric, dimension_key). A 'firing' row
 * exists at most once per key. New breach → update observed_value/fired_at on
 * the existing row. Returns to baseline → transition to 'cleared'.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ALERT_DEDUP_WINDOW_DAYS,
  BASELINE_DAYS,
  ENGAGEMENT_DROP_ABS,
  SESSIONS_THRESHOLD_PCT,
  SHARE_SHIFT_ABS,
} from "./constants";
import type { AlertMetric, AlertStatus } from "./types";

interface SessionDailyRow {
  date: string;
  sessions: number;
  engagement_rate: number;
}

interface TrafficDailyRow {
  date: string;
  source: string;
  medium: string;
  sessions: number;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function offset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// ── Alert lifecycle helpers ──────────────────────────────────────────────────

interface BreachInput {
  instanceId: number;
  metric: AlertMetric;
  dimensionKey: string | null;
  baselineValue: number;
  observedValue: number;
  deltaPct: number;
}

/**
 * Insert a new firing alert OR update the existing one for the same key.
 * Throttling: while a firing alert exists for the key, subsequent breaches
 * update observed/fired_at instead of inserting a duplicate.
 */
async function recordBreach(
  supabase: SupabaseClient,
  b: BreachInput,
): Promise<void> {
  const { data: existing } = await supabase
    .from("ga4_alert")
    .select("alert_id")
    .eq("instance_id", b.instanceId)
    .eq("metric", b.metric)
    .eq("status", "firing")
    .filter(
      "dimension_key",
      b.dimensionKey === null ? "is" : "eq",
      b.dimensionKey === null ? null : b.dimensionKey,
    )
    .maybeSingle();

  if (existing) {
    await supabase
      .from("ga4_alert")
      .update({
        observed_value: b.observedValue,
        baseline_value: b.baselineValue,
        delta_pct: b.deltaPct,
        fired_at: new Date().toISOString(),
      })
      .eq("alert_id", existing.alert_id);
    return;
  }

  await supabase.from("ga4_alert").insert({
    instance_id: b.instanceId,
    metric: b.metric,
    dimension_key: b.dimensionKey,
    baseline_value: b.baselineValue,
    observed_value: b.observedValue,
    delta_pct: b.deltaPct,
    status: "firing" as AlertStatus,
  });
}

/**
 * Auto-clear: any firing alert for (instanceId, metric) whose dimension_key
 * is NOT in `stillBreachingKeys` transitions to cleared.
 *
 * `dimension_key` may be null for top-line metrics — we represent "no
 * dimension" as the sentinel string '' in stillBreachingKeys for set
 * comparison.
 */
async function clearResolved(
  supabase: SupabaseClient,
  instanceId: number,
  metric: AlertMetric,
  stillBreachingKeys: Set<string>,
): Promise<void> {
  const { data: firing } = await supabase
    .from("ga4_alert")
    .select("alert_id, dimension_key")
    .eq("instance_id", instanceId)
    .eq("metric", metric)
    .eq("status", "firing");

  if (!firing) return;
  const toClear = firing
    .filter((r) => !stillBreachingKeys.has(r.dimension_key ?? ""))
    .map((r) => r.alert_id);

  if (toClear.length === 0) return;

  await supabase
    .from("ga4_alert")
    .update({
      status: "cleared",
      cleared_at: new Date().toISOString(),
    })
    .in("alert_id", toClear);
}

// ── Per-instance detection ───────────────────────────────────────────────────

/**
 * Run all three alert checks for one instance. Caller owns iteration.
 *
 * "Yesterday" = the most recent date with a session row, since today's data
 * is still finalizing. We pick the max(date) actually present rather than
 * trusting wall-clock UTC.
 */
export async function runAnomalyDetection(args: {
  instanceId: number;
  supabase?: SupabaseClient;
}): Promise<{ alertsConsidered: number; alertsRecorded: number; alertsCleared: number }> {
  const supabase = args.supabase ?? createServiceRoleClient();
  const { instanceId } = args;

  // Pull last (BASELINE_DAYS + 2) days of session-daily for baseline + observed.
  // BASELINE_DAYS for the rolling window, plus 1 for "yesterday" (observed),
  // plus 1 to allow today's incomplete row to exist without skewing.
  const { data: sessionDaily, error: sErr } = await supabase
    .from("ga4_session_daily")
    .select("date, sessions, engagement_rate")
    .eq("instance_id", instanceId)
    .order("date", { ascending: false })
    .limit(BASELINE_DAYS + 2);

  if (sErr || !sessionDaily || sessionDaily.length === 0) {
    return { alertsConsidered: 0, alertsRecorded: 0, alertsCleared: 0 };
  }

  // Sort ascending for human readability of indices.
  const rows = (sessionDaily as SessionDailyRow[]).slice().sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  // Use the most-recent finalized day as observed. Heuristic: drop the
  // newest row if it's "today" UTC, otherwise use it.
  const todayUtc = isoDate(new Date());
  let observed: SessionDailyRow | undefined;
  let baselineRows: SessionDailyRow[];
  if (rows[rows.length - 1].date === todayUtc) {
    observed = rows[rows.length - 2];
    baselineRows = rows.slice(0, rows.length - 2);
  } else {
    observed = rows[rows.length - 1];
    baselineRows = rows.slice(0, rows.length - 1);
  }

  if (!observed) {
    return { alertsConsidered: 0, alertsRecorded: 0, alertsCleared: 0 };
  }

  // Take the BASELINE_DAYS most recent baseline rows.
  const baseline = baselineRows.slice(-BASELINE_DAYS);

  let recorded = 0;
  let considered = 0;
  let cleared = 0;

  // ── Alert 1: Sessions ±15% ────────────────────────────────────────────────
  if (baseline.length >= 1) {
    considered += 1;
    const baselineSessions =
      baseline.reduce((s, r) => s + r.sessions, 0) / baseline.length;
    if (baselineSessions > 0) {
      const deltaPct =
        ((observed.sessions - baselineSessions) / baselineSessions) * 100;
      if (Math.abs(deltaPct) / 100 > SESSIONS_THRESHOLD_PCT) {
        await recordBreach(supabase, {
          instanceId,
          metric: "sessions",
          dimensionKey: null,
          baselineValue: baselineSessions,
          observedValue: observed.sessions,
          deltaPct,
        });
        recorded += 1;
        await clearResolved(supabase, instanceId, "sessions", new Set([""]));
      } else {
        await clearResolved(supabase, instanceId, "sessions", new Set());
        cleared += 1;
      }
    }
  }

  // ── Alert 2: Engagement Rate −10pp ────────────────────────────────────────
  if (baseline.length >= 1) {
    considered += 1;
    const baselineEr =
      baseline.reduce((s, r) => s + Number(r.engagement_rate), 0) /
      baseline.length;
    const observedEr = Number(observed.engagement_rate);
    const drop = baselineEr - observedEr; // positive when worse
    if (drop > ENGAGEMENT_DROP_ABS) {
      await recordBreach(supabase, {
        instanceId,
        metric: "engagement_rate",
        dimensionKey: null,
        baselineValue: baselineEr,
        observedValue: observedEr,
        deltaPct: baselineEr > 0 ? (-drop / baselineEr) * 100 : -100,
      });
      recorded += 1;
      await clearResolved(
        supabase,
        instanceId,
        "engagement_rate",
        new Set([""]),
      );
    } else {
      await clearResolved(supabase, instanceId, "engagement_rate", new Set());
      cleared += 1;
    }
  }

  // ── Alert 3: Source/Medium share shift > 20pp ─────────────────────────────
  considered += 1;
  const observedDate = observed.date;
  const baselineStart = offset(observedDate, -BASELINE_DAYS);
  const baselineEnd = offset(observedDate, -1);

  const { data: trafficObserved } = await supabase
    .from("ga4_traffic_daily")
    .select("date, source, medium, sessions")
    .eq("instance_id", instanceId)
    .eq("date", observedDate);

  const { data: trafficBaseline } = await supabase
    .from("ga4_traffic_daily")
    .select("date, source, medium, sessions")
    .eq("instance_id", instanceId)
    .gte("date", baselineStart)
    .lte("date", baselineEnd);

  const observedRows = (trafficObserved ?? []) as TrafficDailyRow[];
  const baselineRowsT = (trafficBaseline ?? []) as TrafficDailyRow[];

  const observedTotal = observedRows.reduce((s, r) => s + r.sessions, 0);
  const baselineTotal = baselineRowsT.reduce((s, r) => s + r.sessions, 0);

  // Aggregate by source/medium key.
  const observedShare = new Map<string, number>();
  for (const r of observedRows) {
    const key = `${r.source}/${r.medium}`;
    observedShare.set(
      key,
      (observedShare.get(key) ?? 0) +
        (observedTotal > 0 ? r.sessions / observedTotal : 0),
    );
  }

  const baselineShare = new Map<string, number>();
  for (const r of baselineRowsT) {
    const key = `${r.source}/${r.medium}`;
    baselineShare.set(
      key,
      (baselineShare.get(key) ?? 0) +
        (baselineTotal > 0 ? r.sessions / baselineTotal : 0),
    );
  }

  const allKeys = new Set([...observedShare.keys(), ...baselineShare.keys()]);
  const stillBreaching = new Set<string>();

  if (observedTotal > 0 && baselineTotal > 0) {
    for (const key of allKeys) {
      const obs = observedShare.get(key) ?? 0;
      const base = baselineShare.get(key) ?? 0;
      const delta = obs - base;
      if (Math.abs(delta) > SHARE_SHIFT_ABS) {
        const dimensionKey = `source/medium=${key}`;
        await recordBreach(supabase, {
          instanceId,
          metric: "traffic_share",
          dimensionKey,
          baselineValue: base,
          observedValue: obs,
          deltaPct: delta * 100,
        });
        recorded += 1;
        stillBreaching.add(dimensionKey);
      }
    }
  }

  await clearResolved(supabase, instanceId, "traffic_share", stillBreaching);

  // The `cleared` count is approximate — we rely on clearResolved doing the
  // right thing. Returned for telemetry only.
  void ALERT_DEDUP_WINDOW_DAYS; // surface the constant; future use only
  return {
    alertsConsidered: considered,
    alertsRecorded: recorded,
    alertsCleared: cleared,
  };
}

export async function runAnomalyDetectionForAll(): Promise<
  Array<{ instanceId: number; recorded: number; considered: number }>
> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.rpc("ga4_list_active_instances");
  const list = (data ?? []) as Array<{ instance_id: number }>;
  const out: Array<{ instanceId: number; recorded: number; considered: number }> = [];
  for (const row of list) {
    const r = await runAnomalyDetection({ instanceId: row.instance_id, supabase });
    out.push({
      instanceId: row.instance_id,
      recorded: r.alertsRecorded,
      considered: r.alertsConsidered,
    });
  }
  return out;
}
