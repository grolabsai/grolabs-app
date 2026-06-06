/**
 * Small, deterministic fixtures for the v5 engine tests. NOT a `.test.ts` file,
 * so vitest's `tests/unit/**​/*.test.ts` glob ignores it — it's pure helpers.
 *
 * We build tiny hand-made rubrics (a few checks, made-up weights) rather than
 * the live 55-check seed, so every credit-from-zero total is checkable by hand.
 */

import type {
  AtomicCategory,
  AtomicCheck,
  AtomicStage,
  MetricKind,
  ResultStatus,
  ScoreResult,
  Scorer,
} from "@/lib/diagnostic/v5/types";

export function makeStage(code = "discovery", name = "Discovery"): AtomicStage {
  return { code, name };
}

export function makeCategory(opts: {
  code: string;
  name?: string;
  stage?: AtomicStage;
  isDerived?: boolean;
  weight?: number;
}): AtomicCategory {
  return {
    code: opts.code,
    name: opts.name ?? opts.code,
    stage: opts.stage ?? makeStage(),
    isDerived: opts.isDerived ?? false,
    weight: opts.weight ?? 100,
  };
}

export function makeCheck(opts: {
  id: number;
  code: string;
  category?: AtomicCategory;
  page?: string;
  metric?: MetricKind;
  weight?: number;
  dependsOn?: number | null;
  findingClass?: AtomicCheck["findingClass"];
  lever?: AtomicCheck["revenueLever"];
}): AtomicCheck {
  return {
    checkCode: opts.code,
    diagnosticCheckId: opts.id,
    category: opts.category ?? makeCategory({ code: "seo", weight: 100 }),
    pageType: { code: opts.page ?? "PDP", discoveryHint: null },
    metricKind: opts.metric ?? "binary",
    weight: opts.weight ?? 10,
    capabilityTier: 1,
    findingClass: opts.findingClass ?? "revenue_leak",
    revenueLever: opts.lever ?? "traffic",
    dependsOnCheckId: opts.dependsOn ?? null,
    dependsOnCheckCode: null,
    scoringRubric: null,
    evidenceSources: [],
  };
}

/** A scorer that always returns the given result. */
export function constScorer(result: ScoreResult): Scorer {
  return async () => result;
}

/**
 * Build a dispatcher from a `check_code → ScoreResult` map. Codes absent from
 * the map resolve to `undefined` (the engine then writes `na`, like an
 * unregistered check). A `null` value models a registered-but-throwing scorer.
 */
export function dispatchFrom(
  map: Record<string, ScoreResult | null>,
): (code: string) => Scorer | undefined {
  return (code: string) => {
    if (!(code in map)) return undefined;
    const result = map[code];
    if (result === null) {
      return async () => {
        throw new Error(`boom:${code}`);
      };
    }
    return async () => result;
  };
}

export const PASS: ScoreResult = { score: 100, status: "pass" };
export const FAIL: ScoreResult = { score: 0, status: "fail" };
export function graded(score: number, status: ResultStatus = "partial"): ScoreResult {
  return { score, status };
}
