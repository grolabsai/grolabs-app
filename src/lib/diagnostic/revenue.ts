/**
 * Revenue formula for the Prospectos diagnostic.
 *
 * Per-finding annual uplift estimate (USD):
 *
 *   uplift = traffic × stage_share × baseline_cr × aov × delta_rate × (1 − score/100)
 *
 * Each factor is resolved with the following priority:
 *
 *   stage_share, baseline_cr, delta_rate:
 *     1. vertical_benchmark scoped to (vertical_id, check_id)
 *     2. vertical_benchmark scoped to (vertical_id, stage_id)
 *     3. vertical_benchmark scoped to (vertical_id) with both NULL
 *     4. diagnostic_check.default_delta_rate (delta_rate only)
 *     5. give up — return null
 *
 *   aov:
 *     1. prospect.est_aov_usd
 *     2. vertical_benchmark.default_aov_usd
 *
 *   traffic:
 *     1. prospect.est_annual_traffic
 *     2. give up
 *
 * Passing checks (score >= 90) contribute zero uplift. Lower scores
 * contribute proportionally more. NA / error findings contribute zero.
 *
 * Confidence is the minimum across the inputs — high only when all
 * three of (vertical_benchmark, prospect AOV, prospect traffic) were
 * concrete; lower whenever we leaned on a default.
 */

export type ConfidenceLevel = "low" | "medium" | "high";

export type RevenueInputs = {
  traffic: number | null;
  aov: number | null;
  baselineCr: number | null;
  stageShare: number | null;
  deltaRate: number | null;
  score: number | null;
  resultStatus: string;
};

export type RevenueResult = {
  uplift_usd: number | null;
  confidence: ConfidenceLevel | null;
  missing_inputs: string[];
};

export function computeFindingUplift(input: RevenueInputs): RevenueResult {
  const missing: string[] = [];
  if (input.traffic == null) missing.push("traffic");
  if (input.aov == null) missing.push("aov");
  if (input.baselineCr == null) missing.push("baseline_cr");
  if (input.stageShare == null) missing.push("stage_share");
  if (input.deltaRate == null) missing.push("delta_rate");

  // Non-scoreable findings (NA / error) shouldn't drive uplift.
  if (input.resultStatus === "na" || input.resultStatus === "error") {
    return { uplift_usd: 0, confidence: "low", missing_inputs: missing };
  }

  const score = input.score ?? 0;
  const headroom = Math.max(0, 1 - score / 100);
  if (headroom === 0) {
    return { uplift_usd: 0, confidence: "high", missing_inputs: [] };
  }

  if (missing.length > 0) {
    return { uplift_usd: null, confidence: "low", missing_inputs: missing };
  }

  const uplift =
    input.traffic! *
    input.stageShare! *
    input.baselineCr! *
    input.aov! *
    input.deltaRate! *
    headroom;

  // Round to 2 decimals for storage; the UI further rounds when shown.
  return {
    uplift_usd: Math.round(uplift * 100) / 100,
    confidence: missing.length === 0 ? "high" : "medium",
    missing_inputs: missing,
  };
}

export type BenchmarkRow = {
  vertical_id: number;
  diagnostic_stage_id: number | null;
  diagnostic_check_id: number | null;
  baseline_cr: number | null;
  stage_share: number | null;
  delta_rate: number | null;
  default_aov_usd: number | null;
};

export type ResolvedFactors = {
  baselineCr: number | null;
  stageShare: number | null;
  deltaRate: number | null;
  aov: number | null;
};

/**
 * Pick the best-matching benchmark for a check + stage, honoring the
 * specificity hierarchy (check > stage > vertical). Returns the merged
 * set of factors, with diagnostic_check.default_delta_rate as the final
 * fallback for delta_rate.
 */
export function resolveFactors(opts: {
  benchmarks: BenchmarkRow[];
  checkId: number;
  stageId: number;
  prospectAov: number | null;
  checkDefaultDeltaRate: number | null;
}): ResolvedFactors {
  const { benchmarks, checkId, stageId, prospectAov, checkDefaultDeltaRate } = opts;

  const byCheck = benchmarks.find((b) => b.diagnostic_check_id === checkId);
  const byStage = benchmarks.find(
    (b) => b.diagnostic_stage_id === stageId && b.diagnostic_check_id == null,
  );
  const byVertical = benchmarks.find(
    (b) => b.diagnostic_stage_id == null && b.diagnostic_check_id == null,
  );

  const pick = <K extends keyof BenchmarkRow>(field: K) =>
    (byCheck?.[field] ?? byStage?.[field] ?? byVertical?.[field]) as
      | number
      | null
      | undefined;

  const baselineCr = (pick("baseline_cr") as number | null | undefined) ?? null;
  const stageShare = (pick("stage_share") as number | null | undefined) ?? null;
  const deltaRate =
    (pick("delta_rate") as number | null | undefined) ?? checkDefaultDeltaRate;
  const defaultAov =
    (pick("default_aov_usd") as number | null | undefined) ?? null;

  return {
    baselineCr,
    stageShare,
    deltaRate,
    aov: prospectAov ?? defaultAov,
  };
}
