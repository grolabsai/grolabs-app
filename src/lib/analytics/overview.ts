/**
 * Overview dashboard data layer (B1).
 *
 * Reads metric_daily (the materialized KPI rollups) for an instance over a
 * CLOSED period (through yesterday UTC) and the equal prior period, returning
 * each metric period-aggregated with a delta and a daily trend series for the
 * charts. Pairs with the GA4 fetchers (which power the Traffic section).
 *
 * Aggregation is correct, not naive: rate/ratio metrics (and aov / avg-items,
 * which store numerator+denominator) pool as Σnumerator / Σdenominator over the
 * window — never an average of daily rates. Pure counts (total_sales, orders,
 * search_volume…) sum their daily `value`.
 *
 * See docs/design/conversion-measurement-foundations.md + metrics.ts.
 */

import { createClient } from "@/lib/supabase/server";
import { METRIC_BY_KEY } from "./metrics";

export type OverviewPeriod = 1 | 7 | 15 | 30;

export interface OverviewMetric {
  /** Period-aggregated value (pooled rate or summed count). */
  value: number;
  /** Σ numerator over the window — many metrics encode a count here
   *  (e.g. cart_to_checkout.numerator = checkouts; checkout_to_purchase.numerator = orders). */
  num: number;
  /** Σ denominator over the window — the underlying population count
   *  (e.g. session_conversion.denominator = sessions; avg_click_position.denominator = clicks;
   *  cart_to_checkout.denominator = cart adds). Used to drive the funnel without new metrics. */
  den: number;
  /** Same aggregate over the equal prior period. */
  prior: number;
  /** Σ numerator / Σ denominator over the prior period — lets callers compute a
   *  count delta from the populations (e.g. sessions = denominator). */
  priorNum: number;
  priorDen: number;
  /** Percent change vs prior period — for counts/values. */
  deltaPct: number;
  /** Point change vs prior period (×100) — for ratios. */
  deltaPp: number;
  /** Daily `value` over the current window, ascending — for sparkline/area. */
  series: number[];
  /** True if any current-window row exists. */
  hasData: boolean;
}

interface Row {
  day: string;
  metric_key: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
}

// ── Store-local day windows (instance.timezone, GA4-style) ──────────────────
// "Yesterday" is the STORE's yesterday, not the viewer's and not UTC: day
// boundaries are a property of the store (instance.timezone, IANA), so every
// viewer sees the same numbers and they match the merchant's business day.
// metric_daily is bucketed the same way (instance_day() in the DB).

/** The calendar date of `d` in an IANA timezone, as YYYY-MM-DD. */
function zonedDay(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** YYYY-MM-DD ± n days (pure string math, DST-proof via UTC noon). */
function shiftDay(day: string, delta: number): string {
  const [y, m, dd] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd, 12));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

export interface DayWindow {
  /** IANA zone the boundaries derive from (instance.timezone; UTC fallback). */
  timezone: string;
  /** Human label, e.g. "America/Guatemala (GMT-6)" — display next to "through <date>". */
  tzLabel: string;
  /** Closed current window [start..end] and the equal prior window, store-local days. */
  end: string; start: string; priorEnd: string; priorStart: string;
}

/** The instance's closed reporting window: through the STORE's yesterday. */
export async function getDayWindow(
  instanceId: number,
  periodDays: OverviewPeriod,
): Promise<DayWindow> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instance").select("timezone").eq("instance_id", instanceId).maybeSingle();
  let tz = data?.timezone ?? "UTC";
  let today: string;
  try {
    today = zonedDay(tz, new Date());
  } catch {
    tz = "UTC"; // bad/unknown IANA string in the row — never break the dashboard
    today = zonedDay(tz, new Date());
  }
  const end = shiftDay(today, -1);
  const start = shiftDay(end, -(periodDays - 1));
  const priorEnd = shiftDay(start, -1);
  const priorStart = shiftDay(priorEnd, -(periodDays - 1));
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return { timezone: tz, tzLabel: offset ? `${tz} (${offset})` : tz, end, start, priorEnd, priorStart };
}

/** Metrics whose period value pools as Σnum/Σden (rates + the num/den aggregates). */
function poolsNumDen(key: string): boolean {
  const def = METRIC_BY_KEY[key];
  if (!def) return false;
  if (def.kind === "rate") return true;
  return key === "aov" || key === "avg_items_per_order";
}

const EMPTY: OverviewMetric = {
  value: 0, num: 0, den: 0, prior: 0, priorNum: 0, priorDen: 0,
  deltaPct: 0, deltaPp: 0, series: [], hasData: false,
};

export async function getOverviewMetrics(
  instanceId: number,
  periodDays: OverviewPeriod,
): Promise<Record<string, OverviewMetric>> {
  const supabase = await createClient();

  // Closed window: through the STORE's yesterday (instance.timezone), excluding
  // its partial today — same convention as the GA4 dashboard.
  const w = await getDayWindow(instanceId, periodDays);

  const { data, error } = await supabase
    .from("metric_daily")
    .select("day, metric_key, numerator, denominator, value")
    .eq("instance_id", instanceId)
    .gte("day", w.priorStart)
    .lte("day", w.end);
  if (error) {
    console.error("[overview] metric_daily read failed:", error.message);
    return {};
  }
  const rows = (data ?? []) as Row[];

  const startS = w.start, endS = w.end;
  const pStartS = w.priorStart, pEndS = w.priorEnd;
  const inCur = (d: string) => d >= startS && d <= endS;
  const inPri = (d: string) => d >= pStartS && d <= pEndS;

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byKey.get(r.metric_key);
    if (arr) arr.push(r);
    else byKey.set(r.metric_key, [r]);
  }

  const out: Record<string, OverviewMetric> = {};
  for (const [key, krows] of byKey) {
    const pooled = poolsNumDen(key);
    // Returns { value, num, den } over a window. num/den are the Σ regardless of
    // metric kind (0 for pure counts), so the funnel can read population sizes.
    const agg = (pred: (d: string) => boolean) => {
      const rs = krows.filter((r) => pred(r.day));
      const num = rs.reduce((s, r) => s + Number(r.numerator ?? 0), 0);
      const den = rs.reduce((s, r) => s + Number(r.denominator ?? 0), 0);
      const sumValue = rs.reduce((s, r) => s + Number(r.value ?? 0), 0);
      const value = pooled ? (den > 0 ? num / den : 0) : sumValue;
      return { value, num, den };
    };
    const cur = agg(inCur);
    const pri = agg(inPri);
    const prior = pri.value;
    const series = krows
      .filter((r) => inCur(r.day))
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => Number(r.value ?? 0));
    out[key] = {
      value: cur.value,
      num: cur.num,
      den: cur.den,
      prior,
      priorNum: pri.num,
      priorDen: pri.den,
      deltaPct: prior > 0 ? ((cur.value - prior) / prior) * 100 : 0,
      deltaPp: (cur.value - prior) * 100,
      series,
      hasData: krows.some((r) => inCur(r.day)),
    };
  }
  return out;
}

/** Safe lookup — returns a zeroed metric when the key isn't materialized for the period. */
export function metric(
  metrics: Record<string, OverviewMetric>,
  key: string,
): OverviewMetric {
  return metrics[key] ?? EMPTY;
}

/** Day-aligned daily trend series for the capture funnel tiles. */
export interface FunnelSeries {
  sessions: number[];  // daily session COUNT (session_conversion denominator)
  searches: number[];  // daily search COUNT (search_volume value)
  clickRate: number[]; // daily clicks ÷ searches
  cartRate: number[];  // daily cart adds ÷ searches
}

export async function getFunnelSeries(
  instanceId: number,
  periodDays: OverviewPeriod,
): Promise<FunnelSeries> {
  const supabase = await createClient();
  const w = await getDayWindow(instanceId, periodDays);

  const { data, error } = await supabase
    .from("metric_daily")
    .select("day, metric_key, value, denominator")
    .eq("instance_id", instanceId)
    .in("metric_key", ["session_conversion", "search_volume", "avg_click_position", "cart_to_checkout"])
    .gte("day", w.start)
    .lte("day", w.end);
  if (error || !data) return { sessions: [], searches: [], clickRate: [], cartRate: [] };

  // day → { sessions, searches, clicks, cart }
  const byDay = new Map<string, { sessions: number; searches: number; clicks: number; cart: number }>();
  const get = (d: string) => {
    let v = byDay.get(d);
    if (!v) { v = { sessions: 0, searches: 0, clicks: 0, cart: 0 }; byDay.set(d, v); }
    return v;
  };
  for (const r of data as { day: string; metric_key: string; value: number | null; denominator: number | null }[]) {
    const cell = get(r.day);
    if (r.metric_key === "session_conversion") cell.sessions = Number(r.denominator ?? 0);
    else if (r.metric_key === "search_volume") cell.searches = Number(r.value ?? 0);
    else if (r.metric_key === "avg_click_position") cell.clicks = Number(r.denominator ?? 0);
    else if (r.metric_key === "cart_to_checkout") cell.cart = Number(r.denominator ?? 0);
  }
  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b));
  return {
    sessions: days.map((d) => byDay.get(d)!.sessions),
    searches: days.map((d) => byDay.get(d)!.searches),
    clickRate: days.map((d) => { const c = byDay.get(d)!; return c.searches > 0 ? c.clicks / c.searches : 0; }),
    cartRate: days.map((d) => { const c = byDay.get(d)!; return c.searches > 0 ? c.cart / c.searches : 0; }),
  };
}

/** Spine-derived Users breakdown (identity + recency) for the closed window,
 *  with the equal prior period for deltas. Sourced from analytics_event via the
 *  instance_user_breakdown RPC, so it populates even when GA4 isn't connected. */
export interface UserBreakdown {
  total: number;
  newUsers: number;
  returning: number;
  anonymous: number;
  registered: number;
  /** Identity-coupled recency — the clean 3-way donut partition with anonymous
   *  (newReg + returningReg + anonymous = total). */
  newReg: number;
  returningReg: number;
  /** Daily distinct-user counts over the window (ascending) — Users timeline. */
  series: number[];
  /** Percent change in total users vs the prior equal period. */
  deltaPct: number;
  hasData: boolean;
}

interface BreakdownRow {
  total: number; new_users: number; returning_users: number;
  anonymous: number; registered: number;
  new_registered: number; returning_registered: number;
}

export async function getUserBreakdown(
  instanceId: number,
  periodDays: OverviewPeriod,
): Promise<UserBreakdown> {
  const supabase = await createClient();
  const w = await getDayWindow(instanceId, periodDays);
  const { start, end, priorStart, priorEnd } = w;

  const call = async (s: string, e: string): Promise<BreakdownRow | null> => {
    const { data, error } = await supabase.rpc("instance_user_breakdown", {
      p_instance: instanceId, p_start: s, p_end: e,
    });
    if (error) { console.error("[overview] user breakdown failed:", error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as BreakdownRow | null;
  };

  const series = async (s: string, e: string): Promise<number[]> => {
    const { data, error } = await supabase.rpc("instance_daily_users", {
      p_instance: instanceId, p_start: s, p_end: e,
    });
    if (error || !data) return [];
    return (data as { day: string; users: number }[])
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => Number(r.users ?? 0));
  };

  const [cur, pri, dailyUsers] = await Promise.all([
    call(start, end), call(priorStart, priorEnd), series(start, end),
  ]);
  const total = Number(cur?.total ?? 0);
  const priorTotal = Number(pri?.total ?? 0);
  return {
    total,
    newUsers: Number(cur?.new_users ?? 0),
    returning: Number(cur?.returning_users ?? 0),
    anonymous: Number(cur?.anonymous ?? 0),
    registered: Number(cur?.registered ?? 0),
    newReg: Number(cur?.new_registered ?? 0),
    returningReg: Number(cur?.returning_registered ?? 0),
    series: dailyUsers,
    deltaPct: priorTotal > 0 ? ((total - priorTotal) / priorTotal) * 100 : 0,
    hasData: total > 0,
  };
}
