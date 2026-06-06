/**
 * Prospectos v5 — credit-from-zero roll-up (pure).
 *
 * Two distinct aggregations, because "null" means different things at
 * different levels of the hierarchy (Stage → Category → Item):
 *
 *   creditFromZero  — used at the ITEM level (checks → category) and for a
 *     derived category's contribution edges. Every member STARTS at 0 and
 *     accrues `score/100 × weight` credit. `na` members are excluded from both
 *     numerator and denominator. A `blocked`/`fail` member (score 0/null but
 *     status ≠ na) stays in the denominator — its potential credit was simply
 *     not earned. Never "start at 100 and deduct."
 *
 *   weightedAverage — used at the CATEGORY level (categories → stage). A
 *     category whose score is null had only `na` members, so it has nothing to
 *     contribute and is excluded; otherwise its 0–100 score is averaged in,
 *     weighted by the category's share of the stage.
 *
 * Weights come from the DB (`diagnostic_check.weight`,
 * `diagnostic_category.weight`, `diagnostic_category_contribution.weight`) via
 * the loaded `AtomicCheck`s and the supplied contribution edges — nothing here
 * hardcodes a weight (CLAUDE.md §5).
 */

import type {
  AtomicCategory,
  AtomicStage,
  CheckScore,
  DerivedCategoryInput,
  ResultStatus,
  ScoredCategory,
  ScoredStage,
} from "./types";

/** A member of a credit-from-zero group. */
export type WeightedItem = {
  score: number | null;
  status: ResultStatus;
  weight: number;
};

/**
 * Credit-from-zero: `Σ(score/100 × weight) ÷ Σ(weight of non-na members) × 100`.
 *
 * Returns null when every member is `na` (the group has no measurable signal).
 * `blocked`/`fail` members (status ≠ na) contribute 0 to the numerator and
 * their full weight to the denominator — i.e. potential credit not earned.
 */
export function creditFromZero(items: WeightedItem[]): number | null {
  let earned = 0;
  let denom = 0;
  for (const it of items) {
    if (it.status === "na") continue; // excluded from numerator AND denominator
    earned += ((it.score ?? 0) / 100) * it.weight; // blocked/fail → 0 credit
    denom += it.weight;
  }
  if (denom === 0) return null;
  return Math.round((earned / denom) * 100);
}

/**
 * Plain weighted average of non-null values. Used to roll categories into a
 * stage: a null category score (all-`na`) is skipped entirely.
 */
export function weightedAverage(
  items: { value: number | null; weight: number }[],
): number | null {
  let sum = 0;
  let denom = 0;
  for (const it of items) {
    if (it.value === null) continue;
    sum += it.value * it.weight;
    denom += it.weight;
  }
  if (denom === 0) return null;
  return Math.round(sum / denom);
}

/** Roll a non-derived category up from its member checks (credit-from-zero). */
export function rollupCategory(
  category: AtomicCategory,
  checks: CheckScore[],
): ScoredCategory {
  const score = creditFromZero(
    checks.map((c) => ({
      score: c.score,
      status: c.status,
      weight: c.check.weight,
    })),
  );
  return { category, score, isDerived: false, checks };
}

/**
 * Compute a derived category (e.g. `returns_risk`) from its contribution edges.
 * Each edge points at a source check's already-computed `CheckScore`; the same
 * credit-from-zero rule applies over the contribution weights. A source check
 * missing from the run is treated as absent (excluded). Run AFTER the source
 * checks are scored.
 */
export function computeDerivedCategory(
  input: DerivedCategoryInput,
  byCheckId: ReadonlyMap<number, CheckScore>,
): ScoredCategory {
  const items: WeightedItem[] = [];
  for (const edge of input.contributions) {
    const src = byCheckId.get(edge.sourceCheckId);
    if (!src) continue; // source not in this run → nothing to contribute
    items.push({ score: src.score, status: src.status, weight: edge.weight });
  }
  return {
    category: input.category,
    score: creditFromZero(items),
    isDerived: true,
    checks: [],
  };
}

/** Roll a stage up from its categories (weighted average, null categories skipped). */
export function rollupStage(
  stage: AtomicStage,
  categories: ScoredCategory[],
): ScoredStage {
  const score = weightedAverage(
    categories.map((c) => ({ value: c.score, weight: c.category.weight })),
  );
  return { stage, score, categories };
}
