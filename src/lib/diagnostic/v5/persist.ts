/**
 * Prospectos v5 — persistence (thin IO layer over the engine's scored tree).
 *
 * Writes two things for one run:
 *   1. `finding` — one row per check (the atomic-rubric grain: one check →
 *      one finding → one progress series). `result_status` carries the new
 *      `blocked` value; `score` is the rounded earned credit (null for `na`,
 *      0 for `blocked`).
 *   2. `run_category_score` — one upserted row per scored category (the
 *      normalized per-category rollup + estimated annual uplift).
 *
 * `finding_class` has NO column on `finding` (it lives on `diagnostic_check`,
 * joinable via `diagnostic_check_id`); we mirror it into the `evidence` JSONB
 * so a finding row is self-describing without a join. We add no columns.
 *
 * Uplift reuses the legacy revenue helpers — but those need run-level
 * economics (benchmarks, prospect traffic/AOV) that this layer doesn't load.
 * So the caller (Prompt 6) injects a per-check `checkUplift` closure built from
 * `resolveFactors` + `computeFindingUplift`; persist sums it per category. With
 * no closure, uplift is left null (we never guess). If any scoreable member's
 * uplift is null (a missing factor), the whole category uplift is null rather
 * than an understated partial sum. Derived categories re-weight existing
 * findings, so their uplift is left null to avoid double-counting.
 *
 * Multi-tenancy (CLAUDE.md §2): `instanceId` is written verbatim — `0` (the
 * template instance) and `null` (anonymous run) are BOTH real, distinct values;
 * strict null checks throughout, never a falsy collapse. RLS on
 * `run_category_score` (member-rw, anon-read for null-instance runs) and
 * `finding` governs who may write; callers use the matching client
 * (service-role for anonymous runs).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfidenceLevel, RevenueResult } from "../revenue";
import type {
  AtomicCheck,
  CheckScore,
  ResultStatus,
  ScoredCategory,
  ScoredRun,
} from "./types";

/** Per-check uplift, computed by the caller via the legacy revenue helpers. */
export type CheckUpliftFn = (input: {
  check: AtomicCheck;
  score: number | null;
  status: ResultStatus;
}) => RevenueResult;

export type PersistScoredRunInput = {
  supabase: SupabaseClient;
  /** `diagnostic_run.run_id` (uuid). */
  runId: string;
  /** Resolved instance: `0` = template, real id, or `null` = anonymous run. */
  instanceId: number | null;
  /** The engine's output tree. */
  scored: ScoredRun;
  /**
   * `category_code → diagnostic_category_id`, resolved by the caller from the
   * loaded rubric. A category whose id is missing here is skipped (its
   * `run_category_score` row needs a non-null FK) with a console warning.
   */
  categoryIdByCode: ReadonlyMap<string, number>;
  /** Optional per-check uplift; omitted → all uplift null. */
  checkUplift?: CheckUpliftFn;
};

export type PersistScoredRunResult = {
  findingsInserted: number;
  categoryScoresUpserted: number;
  skippedCategories: string[];
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** The least-confident of the inputs (mirrors revenue.ts's "min across inputs"). */
function minConfidence(levels: ConfidenceLevel[]): ConfidenceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((a, b) => (CONFIDENCE_RANK[b] < CONFIDENCE_RANK[a] ? b : a));
}

/**
 * Sum per-check uplift across a category's member checks. `na` members
 * contribute nothing. A member whose uplift is null (missing factor) collapses
 * the whole category to null — we don't ship an understated partial.
 */
function sumCategoryUplift(
  members: CheckScore[],
  upliftByCheckId: ReadonlyMap<number, RevenueResult>,
): { uplift: number | null; confidence: ConfidenceLevel | null } {
  let sum = 0;
  let sawScoreable = false;
  const confidences: ConfidenceLevel[] = [];
  for (const cs of members) {
    if (cs.status === "na") continue;
    const up = upliftByCheckId.get(cs.check.diagnosticCheckId);
    if (!up || up.uplift_usd === null) return { uplift: null, confidence: "low" };
    sum += up.uplift_usd;
    if (up.confidence) confidences.push(up.confidence);
    sawScoreable = true;
  }
  if (!sawScoreable) return { uplift: 0, confidence: "high" };
  return { uplift: Math.round(sum * 100) / 100, confidence: minConfidence(confidences) };
}

/** Resolve a category's uplift: derived categories stay null (avoid double-count). */
function categoryUplift(
  category: ScoredCategory,
  upliftByCheckId: ReadonlyMap<number, RevenueResult>,
  hasUpliftFn: boolean,
): { uplift: number | null; confidence: ConfidenceLevel | null } {
  if (!hasUpliftFn || category.isDerived) {
    return { uplift: null, confidence: null };
  }
  return sumCategoryUplift(category.checks, upliftByCheckId);
}

/** A finding-row score: null for `na`, otherwise the rounded earned credit. */
function findingScore(cs: CheckScore): number | null {
  return cs.status === "na" ? null : Math.round(cs.score ?? 0);
}

/**
 * Persist a scored run. Throws on a write error (the caller decides how to mark
 * the run failed) rather than swallowing it.
 */
export async function persistScoredRun(
  input: PersistScoredRunInput,
): Promise<PersistScoredRunResult> {
  const { supabase, runId, instanceId, scored, categoryIdByCode, checkUplift } =
    input;

  // Compute per-check uplift once; reused by both the finding rows and the
  // per-category sums so the two stay consistent.
  const upliftByCheckId = new Map<number, RevenueResult>();
  if (checkUplift) {
    for (const cs of scored.checks) {
      upliftByCheckId.set(
        cs.check.diagnosticCheckId,
        checkUplift({ check: cs.check, score: cs.score, status: cs.status }),
      );
    }
  }

  // ── 1. finding — one row per check ────────────────────────────────────
  const findingRows = scored.checks.map((cs) => {
    const up = upliftByCheckId.get(cs.check.diagnosticCheckId);
    return {
      run_id: runId,
      instance_id: instanceId, // 0 and null are both real; written verbatim
      diagnostic_check_id: cs.check.diagnosticCheckId,
      score: findingScore(cs),
      result_status: cs.status,
      // No finding_class column on `finding` — mirror it into evidence so the
      // row is self-describing without a join back to diagnostic_check.
      evidence: { ...(cs.evidence ?? {}), finding_class: cs.check.findingClass },
      notes: cs.note ?? null,
      est_annual_uplift_usd: up?.uplift_usd ?? null,
      est_confidence: up?.confidence ?? null,
    };
  });

  if (findingRows.length > 0) {
    const { error } = await supabase.from("finding").insert(findingRows);
    if (error) {
      throw new Error(`persistScoredRun: finding insert failed: ${error.message}`);
    }
  }

  // ── 2. run_category_score — one upsert per scored category ────────────
  const skippedCategories: string[] = [];
  const scoreRows = [];
  for (const category of scored.categories) {
    const categoryId = categoryIdByCode.get(category.category.code);
    if (categoryId === undefined) {
      // Can't write a null FK; surface the gap rather than dropping silently.
      console.warn(
        `persistScoredRun: no diagnostic_category_id for "${category.category.code}" — skipping run_category_score`,
      );
      skippedCategories.push(category.category.code);
      continue;
    }
    const { uplift, confidence } = categoryUplift(
      category,
      upliftByCheckId,
      Boolean(checkUplift),
    );
    scoreRows.push({
      run_id: runId,
      instance_id: instanceId, // 0 / null both real
      diagnostic_category_id: categoryId,
      score: category.score, // already 0–100 int (or null when all-na)
      est_annual_uplift_usd: uplift,
      est_confidence: confidence,
    });
  }

  let categoryScoresUpserted = 0;
  if (scoreRows.length > 0) {
    const { error } = await supabase
      .from("run_category_score")
      .upsert(scoreRows, { onConflict: "run_id,diagnostic_category_id" });
    if (error) {
      throw new Error(
        `persistScoredRun: run_category_score upsert failed: ${error.message}`,
      );
    }
    categoryScoresUpserted = scoreRows.length;
  }

  return {
    findingsInserted: findingRows.length,
    categoryScoresUpserted,
    skippedCategories,
  };
}
