/**
 * Per-instance analysis configuration (instance.analysis_config JSONB).
 *
 * Every number the signal engine judges with is a VARIABLE, not a constant —
 * industries differ, so each store tunes its own (design decision 2026-07-19).
 * The DB column default carries these presets, so new instances are born
 * configured; this module merges whatever the row holds over the same presets
 * so partially-edited configs never break.
 *
 * PURE module (no server imports) — client components import types and
 * presets from here; the DB read lives in signals.ts.
 */

export const WEEK_DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/** Per-metric intentional band: the deal the business made with itself. */
export interface MetricGoal {
  target?: number | null;
  lower_threshold?: number | null;
}

export interface AnalysisConfig {
  /** Analysis weeks END on this day (default sunday → Mon–Sun weeks). */
  week_end_day: WeekDay;
  /** Confirmed decline ≥ this % → red stroke; below it → yellow. */
  delta_threshold_pct: number;
  /** Rates with a smaller weekly denominator show counts instead of %. */
  min_weekly_denominator: number;
  /** How many closed weeks define "normal" (the statistical baseline). */
  baseline_weeks: number;
  /** metric_key → intentional band. Empty by default: targets are business
   *  numbers users set; the statistical band is the fallback. */
  metric_goals: Record<string, MetricGoal>;
}

export const ANALYSIS_PRESETS: AnalysisConfig = {
  week_end_day: "sunday",
  delta_threshold_pct: 5,
  min_weekly_denominator: 30,
  baseline_weeks: 8,
  metric_goals: {},
};

/** ISO weekday (1=Mon..7=Sun) the analysis week STARTS on. */
export function weekStartIso(cfg: Pick<AnalysisConfig, "week_end_day">): number {
  const endIso = WEEK_DAYS.indexOf(cfg.week_end_day) + 1; // monday=1..sunday=7
  return (endIso % 7) + 1;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Merge a raw JSONB value over the presets (tolerates partial/legacy rows). */
export function mergeAnalysisConfig(raw: unknown): AnalysisConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const wed = WEEK_DAYS.includes(r.week_end_day as WeekDay)
    ? (r.week_end_day as WeekDay)
    : ANALYSIS_PRESETS.week_end_day;
  const goals: Record<string, MetricGoal> = {};
  if (r.metric_goals && typeof r.metric_goals === "object") {
    for (const [k, g] of Object.entries(r.metric_goals as Record<string, MetricGoal>)) {
      if (!g || typeof g !== "object") continue;
      const target = Number(g.target);
      const lower = Number(g.lower_threshold);
      goals[k] = {
        target: Number.isFinite(target) ? target : null,
        lower_threshold: Number.isFinite(lower) ? lower : null,
      };
    }
  }
  return {
    week_end_day: wed,
    delta_threshold_pct: num(r.delta_threshold_pct, ANALYSIS_PRESETS.delta_threshold_pct),
    min_weekly_denominator: num(r.min_weekly_denominator, ANALYSIS_PRESETS.min_weekly_denominator),
    baseline_weeks: num(r.baseline_weeks, ANALYSIS_PRESETS.baseline_weeks),
    metric_goals: goals,
  };
}
