/**
 * Signals dashboard data layer — "are we improving or are we getting worse?"
 *
 * Where the Overview tab reports point-in-time aggregates with prior-period
 * deltas, this layer answers the owner's question with accumulated evidence
 * over CLOSED Mon–Sun store-local weeks (instance.timezone), per the
 * signal-based analytics rules:
 *
 *  - Comparison unit: complete weeks only. The in-progress week is returned
 *    separately and never enters a comparison or a signal.
 *  - Noise vs signal: an XmR process-behaviour baseline (centre line + natural
 *    process limits from the first weeks) decides what "normal range" means.
 *  - Slow drift: one-sided CUSUMs accumulate small weekly shortfalls/excesses
 *    that point-to-point deltas can never see (the "six weeks of −1%" blind
 *    spot). k = 0.5σ, decision limit h = 5σ (conservative, rare false alarms).
 *  - Small samples: rate metrics whose latest weekly denominator is under
 *    MIN_WEEKLY_DEN are flagged low-volume — the UI shows counts, not %.
 *
 * Statistical shape follows Wheeler's XmR construction (limits = centre ±
 * 2.66·mean moving range; σ estimated as mR̄/1.128) and standard tabular CUSUM.
 */

import { createClient } from "@/lib/supabase/server";
import { getDayWindow } from "./overview";

// ── Tuning constants (open decisions from the design session — revisit) ─────
/** Minimum closed weeks before any verdict is attempted. */
export const MIN_CLOSED_WEEKS = 5;
/** Baseline = the first up-to-this-many closed weeks. */
export const BASELINE_MAX_WEEKS = 8;
/** Western-Electric-style run rule: this many consecutive weeks one side of centre. */
export const RUN_RULE_LEN = 8;
/** CUSUM slack, in σ units (drift smaller than this is ignored). */
export const CUSUM_K_SIGMA = 0.5;
/** CUSUM decision limit, in σ units (5σ ⇒ rare false alarms). */
export const CUSUM_H_SIGMA = 5;
/** Rate metrics need at least this weekly denominator to show a percentage. */
export const MIN_WEEKLY_DEN = 30;
/** How much closed history to load (weeks). */
const HISTORY_WEEKS = 26;
/** Daily rhythm chart window (days, closed). */
const DAILY_WINDOW = 56;

// ── Signal metric catalog ───────────────────────────────────────────────────
// The signals tab tracks a curated set. `source` is the metric_daily key;
// `take` says how a weekly point is built from the daily rows (rates pool as
// Σnum/Σden — never an average of daily rates; `den` lifts a population count
// out of a rate metric, e.g. sessions from session_conversion's denominator).

export type SignalKind = "count" | "money" | "rate";
export type GoodDirection = "up" | "down";

export interface SignalMetricDef {
  key: string;
  source: string;
  take: "value" | "den" | "rate";
  kind: SignalKind;
  good: GoodDirection;
}

export const SIGNAL_METRICS: readonly SignalMetricDef[] = [
  { key: "total_sales", source: "total_sales", take: "value", kind: "money", good: "up" },
  { key: "orders", source: "orders", take: "value", kind: "count", good: "up" },
  { key: "sessions", source: "session_conversion", take: "den", kind: "count", good: "up" },
  { key: "session_conversion", source: "session_conversion", take: "rate", kind: "rate", good: "up" },
  { key: "search_ctr", source: "search_ctr", take: "rate", kind: "rate", good: "up" },
  { key: "no_result_rate", source: "no_result_rate", take: "rate", kind: "rate", good: "down" },
];

export const SIGNAL_METRIC_BY_KEY: Record<string, SignalMetricDef> = Object.fromEntries(
  SIGNAL_METRICS.map((m) => [m.key, m]),
);

// ── Types ───────────────────────────────────────────────────────────────────

export interface WeekPoint {
  /** Monday of the store-local week, YYYY-MM-DD. */
  weekStart: string;
  value: number;
  num: number;
  den: number;
  /** Distinct days with data inside the week. */
  days: number;
}

export interface DayPoint {
  day: string;
  value: number;
}

export type SignalState = "improving" | "stable" | "declining" | "insufficient";
/** Machine reason codes — the page maps them to i18n sentences. */
export type SignalReason =
  | "limit_low" | "limit_high"
  | "run_low" | "run_high"
  | "cusum_low" | "cusum_high";

export interface Baseline {
  /** Centre line (mean of the baseline weeks). */
  cl: number;
  ucl: number;
  lcl: number;
  /** σ estimate (mR̄ / 1.128). */
  sigma: number;
  /** Number of weeks the baseline was computed from. */
  n: number;
}

export interface SeriesAnalysis {
  values: number[];
  baseline: Baseline | null;
  /** Trailing consecutive weeks one side of centre: +n above, −n below, 0 on centre/empty. */
  run: number;
  /** One-sided CUSUM accumulating EXCESS above centre (detects sustained rises). */
  cusumUp: number[];
  /** One-sided CUSUM accumulating SHORTFALL below centre (detects sustained drops). */
  cusumDown: number[];
  /** Decision limit (5σ) and slack (0.5σ) in metric units. */
  h: number;
  k: number;
  /** First index where each CUSUM crossed h; −1 if never. */
  cusumUpCross: number;
  cusumDownCross: number;
  /** Week-over-week percent change per week (null for the first / zero-prior weeks). */
  wow: (number | null)[];
  /** Indexes of weeks outside the process limits. */
  outside: number[];
  state: SignalState;
  reasons: SignalReason[];
  /** Latest value vs centre, as a percent of centre (the accumulated drift). */
  driftPct: number;
}

export interface MetricSignal extends SeriesAnalysis {
  def: SignalMetricDef;
  weeks: WeekPoint[];
  /** The in-progress week (never part of the analysis), if any data exists. */
  partial: WeekPoint | null;
  latest: WeekPoint | null;
  /** Rate metric whose latest weekly denominator is below MIN_WEEKLY_DEN. */
  lowVolume: boolean;
}

export interface SignalsData {
  timezone: string;
  tzLabel: string;
  /** The store's yesterday (last closed day). */
  end: string;
  /** Monday of the last CLOSED week. */
  lastClosedWeekStart: string;
  metrics: Record<string, MetricSignal>;
  /** Daily sessions over the last DAILY_WINDOW closed days (ascending). */
  dailySessions: DayPoint[];
  closedWeeks: number;
}

// ── Date helpers (UTC-noon string math — DST-proof, mirrors overview.ts) ────

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `day`. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = t.getUTCDay(); // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7));
}

// ── Pure analysis (exported for tests) ──────────────────────────────────────

/**
 * XmR baseline + run rule + one-sided CUSUMs + state over a closed-week series.
 * Pure — no I/O — so the statistical behaviour is testable in isolation.
 */
export function analyzeSeries(values: number[], good: GoodDirection): SeriesAnalysis {
  const n = values.length;
  const empty: SeriesAnalysis = {
    values, baseline: null, run: 0, cusumUp: [], cusumDown: [],
    h: 0, k: 0, cusumUpCross: -1, cusumDownCross: -1,
    wow: values.map(() => null), outside: [], state: "insufficient", reasons: [], driftPct: 0,
  };
  if (n < MIN_CLOSED_WEEKS) return empty;

  // Baseline: the first up-to-8 closed weeks define "normal".
  const bn = Math.min(BASELINE_MAX_WEEKS, n);
  const base = values.slice(0, bn);
  const cl = base.reduce((s, v) => s + v, 0) / bn;
  let mrSum = 0;
  for (let i = 1; i < bn; i++) mrSum += Math.abs(base[i] - base[i - 1]);
  const mR = mrSum / (bn - 1);
  // Degenerate baseline (identical weeks): fall back to a small floor so the
  // limits have width and a single noisy week can't scream.
  const sigma = mR > 0 ? mR / 1.128 : Math.max(Math.abs(cl) * 0.05, 1e-9);
  const ucl = cl + 2.66 * (mR > 0 ? mR : sigma * 1.128);
  const lcl = cl - 2.66 * (mR > 0 ? mR : sigma * 1.128);
  const baseline: Baseline = { cl, ucl, lcl, sigma, n: bn };

  // Trailing run relative to centre.
  let run = 0;
  for (let i = n - 1; i >= 0; i--) {
    const side = values[i] > cl ? 1 : values[i] < cl ? -1 : 0;
    if (side === 0) break;
    if (run === 0) run = side;
    else if (Math.sign(run) === side) run += side;
    else break;
  }

  // One-sided tabular CUSUMs vs the baseline centre.
  const k = CUSUM_K_SIGMA * sigma;
  const h = CUSUM_H_SIGMA * sigma;
  const cusumUp: number[] = [];
  const cusumDown: number[] = [];
  let up = 0, down = 0, upCross = -1, downCross = -1;
  values.forEach((v, i) => {
    up = Math.max(0, up + (v - cl) - k);
    down = Math.max(0, down + (cl - v) - k);
    cusumUp.push(up);
    cusumDown.push(down);
    if (upCross === -1 && up > h) upCross = i;
    if (downCross === -1 && down > h) downCross = i;
  });

  const wow = values.map((v, i) =>
    i === 0 || values[i - 1] === 0 ? null : ((v - values[i - 1]) / values[i - 1]) * 100,
  );
  const outside = values
    .map((v, i) => (v > ucl || v < lcl ? i : -1))
    .filter((i) => i >= 0);

  // Evidence on each side. A side "signals" when the latest week sits beyond
  // its limit, the trailing run reaches RUN_RULE_LEN, or its CUSUM is over h NOW.
  const last = values[n - 1];
  const lowSignals: SignalReason[] = [];
  const highSignals: SignalReason[] = [];
  if (last < lcl) lowSignals.push("limit_low");
  if (last > ucl) highSignals.push("limit_high");
  if (run <= -RUN_RULE_LEN) lowSignals.push("run_low");
  if (run >= RUN_RULE_LEN) highSignals.push("run_high");
  if (down > h) lowSignals.push("cusum_low");
  if (up > h) highSignals.push("cusum_high");

  const badSide = good === "up" ? lowSignals : highSignals;
  const goodSide = good === "up" ? highSignals : lowSignals;
  const state: SignalState = badSide.length > 0 ? "declining" : goodSide.length > 0 ? "improving" : "stable";
  const reasons = badSide.length > 0 ? badSide : goodSide;
  const driftPct = cl !== 0 ? ((last - cl) / Math.abs(cl)) * 100 : 0;

  return {
    values, baseline, run, cusumUp, cusumDown, h, k,
    cusumUpCross: upCross, cusumDownCross: downCross,
    wow, outside, state, reasons, driftPct,
  };
}

/** Bucket daily metric rows into store-local Mon–Sun weeks (pure, testable). */
export function bucketWeeks(
  rows: { day: string; num: number; den: number; value: number }[],
  take: SignalMetricDef["take"],
): WeekPoint[] {
  const byWeek = new Map<string, { num: number; den: number; value: number; days: number }>();
  for (const r of rows) {
    const wk = mondayOf(r.day);
    let cell = byWeek.get(wk);
    if (!cell) { cell = { num: 0, den: 0, value: 0, days: 0 }; byWeek.set(wk, cell); }
    cell.num += r.num;
    cell.den += r.den;
    cell.value += r.value;
    cell.days += 1;
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, c]) => ({
      weekStart,
      num: c.num,
      den: c.den,
      days: c.days,
      value: take === "rate" ? (c.den > 0 ? c.num / c.den : 0) : take === "den" ? c.den : c.value,
    }));
}

// ── Data fetch ──────────────────────────────────────────────────────────────

export async function getSignalsData(instanceId: number): Promise<SignalsData> {
  const supabase = await createClient();
  // period arg only shapes the prior window, which we ignore — we need the
  // store timezone + its closed "yesterday".
  const w = await getDayWindow(instanceId, 1);
  const yesterday = w.end;
  // A Mon–Sun week is closed iff its Sunday <= the store's yesterday.
  const curMonday = mondayOf(yesterday);
  const lastClosedWeekStart =
    shiftDay(curMonday, 6) <= yesterday ? curMonday : shiftDay(curMonday, -7);
  const historyStart = shiftDay(lastClosedWeekStart, -7 * (HISTORY_WEEKS - 1));

  const sourceKeys = [...new Set(SIGNAL_METRICS.map((m) => m.source))];
  const { data, error } = await supabase
    .from("metric_daily")
    .select("day, metric_key, numerator, denominator, value")
    .eq("instance_id", instanceId)
    .in("metric_key", sourceKeys)
    .gte("day", historyStart);
  if (error) console.error("[signals] metric_daily read failed:", error.message);

  const rows = (data ?? []) as {
    day: string; metric_key: string;
    numerator: number | null; denominator: number | null; value: number | null;
  }[];

  const bySource = new Map<string, { day: string; num: number; den: number; value: number }[]>();
  for (const r of rows) {
    const arr = bySource.get(r.metric_key) ?? [];
    arr.push({
      day: r.day,
      num: Number(r.numerator ?? 0),
      den: Number(r.denominator ?? 0),
      value: Number(r.value ?? 0),
    });
    if (arr.length === 1) bySource.set(r.metric_key, arr);
  }

  const metrics: Record<string, MetricSignal> = {};
  let closedWeeks = 0;
  for (const def of SIGNAL_METRICS) {
    const srcRows = bySource.get(def.source) ?? [];
    const allWeeks = bucketWeeks(srcRows, def.take);
    const weeks = allWeeks.filter((p) => p.weekStart <= lastClosedWeekStart);
    const partial = allWeeks.find((p) => p.weekStart > lastClosedWeekStart) ?? null;
    const analysis = analyzeSeries(weeks.map((p) => p.value), def.good);
    const latest = weeks.length > 0 ? weeks[weeks.length - 1] : null;
    const lowVolume =
      def.take === "rate" && latest !== null && latest.den < MIN_WEEKLY_DEN;
    metrics[def.key] = { def, weeks, partial, latest, lowVolume, ...analysis };
    closedWeeks = Math.max(closedWeeks, weeks.length);
  }

  // Daily sessions (closed days) for the rhythm chart.
  const dailyStart = shiftDay(yesterday, -(DAILY_WINDOW - 1));
  const dailySessions: DayPoint[] = (bySource.get("session_conversion") ?? [])
    .filter((r) => r.day >= dailyStart && r.day <= yesterday)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({ day: r.day, value: r.den }));

  return {
    timezone: w.timezone,
    tzLabel: w.tzLabel,
    end: yesterday,
    lastClosedWeekStart,
    metrics,
    dailySessions,
    closedWeeks,
  };
}

/** Trailing 7-day rolling mean aligned to `values` (null until 7 points exist). */
export function rolling7(values: number[]): (number | null)[] {
  return values.map((_, i) => {
    if (i < 6) return null;
    let s = 0;
    for (let j = i - 6; j <= i; j++) s += values[j];
    return s / 7;
  });
}
