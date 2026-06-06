/**
 * Prospectos v5 — scoring engine (pure orchestration, no IO).
 *
 * `scoreRun` walks the loaded `AtomicCheck`s in dependency order, scores each
 * by dispatching to a registry scorer, applies the locked blocked/na rules,
 * and rolls the results up into categories and stages. It returns an in-memory
 * `ScoredRun` tree — persistence is persist.ts's job, page discovery is Prompt
 * 4's, and real scorers arrive in Prompt 5. Until then the registry returns
 * `na` stubs, so the real-data path here is correctly inert; tests inject a
 * mock dispatcher to exercise the math.
 *
 * Locked semantics implemented here (see the prompt + prospectos.draft.md):
 *   - Page availability: if `availablePages` is supplied and a check's page was
 *     not discovered, the check is `na` (excluded) — the scorer never runs.
 *   - Dependency gate (in-run prerequisite only): a prerequisite that is `na`
 *     makes its dependent `na` (can't evaluate); a prerequisite that is UNMET
 *     (status fail/blocked, or score 0) makes its dependent `blocked` (score 0,
 *     counted in the denominator). Otherwise the dependent is scored normally.
 *   - Missing scorer / scorer error → `na` (never a silent drop).
 */

import { orderChecksByDependency } from "./ordering";
import {
  computeDerivedCategory,
  rollupCategory,
  rollupStage,
  weightedAverage,
} from "./rollup";
import type {
  AtomicCategory,
  AtomicCheck,
  AtomicStage,
  CheckScore,
  DerivedCategoryInput,
  ScoredCategory,
  ScoredStage,
  ScoredRun,
  Scorer,
  ScoreResult,
  V5RunContext,
} from "./types";

/** Resolve a scorer for a check code, or undefined if none is registered. */
export type Dispatch = (checkCode: string) => Scorer | undefined;

export type ScoreRunInput = {
  /** The loaded checks for this run (from `loadAtomicChecks`). */
  checks: AtomicCheck[];
  /** Registry lookup (inject `getScorer`; tests inject a mock). */
  dispatch: Dispatch;
  /** Run context handed to every scorer. */
  ctx: V5RunContext;
  /**
   * `page_type.code`s discovered as available (Prompt 4). A check whose page is
   * not in this set is scored `na`. `null`/omitted = no page-gating (treat all
   * pages as available — the correct default until Prompt 4 wires discovery).
   */
  availablePages?: ReadonlySet<string> | null;
  /**
   * Derived categories (e.g. `returns_risk`) + their contribution edges,
   * loaded from the DB by the caller. Computed after the source checks score.
   */
  derivedCategories?: DerivedCategoryInput[];
};

/** A prerequisite is "unmet" when its capability is absent, not merely imperfect. */
function prerequisiteUnmet(parent: CheckScore): boolean {
  return (
    parent.status === "fail" ||
    parent.status === "blocked" ||
    parent.score === 0
  );
}

/** Clamp a scorer's raw score into 0–100 (or null). */
function normalize(check: AtomicCheck, r: ScoreResult): CheckScore {
  const score =
    r.score === null || r.score === undefined
      ? null
      : Math.max(0, Math.min(100, r.score));
  return { check, score, status: r.status, evidence: r.evidence, note: r.note };
}

async function scoreOne(
  check: AtomicCheck,
  opts: {
    dispatch: Dispatch;
    ctx: V5RunContext;
    availablePages: ReadonlySet<string> | null;
    byId: ReadonlyMap<number, CheckScore>;
  },
): Promise<CheckScore> {
  const { dispatch, ctx, availablePages, byId } = opts;

  // 1. Page availability — a check on an undiscovered page can't be measured.
  if (availablePages !== null && !availablePages.has(check.pageType.code)) {
    return { check, score: null, status: "na", note: "page_unavailable" };
  }

  // 2. Dependency gate — only when the prerequisite is part of this run.
  if (check.dependsOnCheckId !== null) {
    const parent = byId.get(check.dependsOnCheckId);
    if (parent) {
      if (parent.status === "na") {
        // Prerequisite not evaluable → dependent not evaluable (na, not blocked).
        return {
          check,
          score: null,
          status: "na",
          note: `prereq_na:${parent.check.checkCode}`,
        };
      }
      if (prerequisiteUnmet(parent)) {
        // Prerequisite unmet → dependent earns 0, counted in the denominator.
        return {
          check,
          score: 0,
          status: "blocked",
          note: `blocked_by:${parent.check.checkCode}`,
        };
      }
    }
  }

  // 3. Dispatch to the registered scorer.
  const scorer = dispatch(check.checkCode);
  if (!scorer) {
    return { check, score: null, status: "na", note: "no_scorer" };
  }
  try {
    return normalize(check, await scorer(check, ctx));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { check, score: null, status: "na", note: `error:${message}` };
  }
}

/**
 * Score one run end-to-end into an in-memory tree. No IO — feed it loaded
 * checks + a dispatcher and it returns per-check, per-category, and per-stage
 * results plus an overall.
 */
export async function scoreRun(input: ScoreRunInput): Promise<ScoredRun> {
  const {
    checks,
    dispatch,
    ctx,
    availablePages = null,
    derivedCategories = [],
  } = input;

  // Walk in dependency order so each parent is scored before its dependents.
  const ordered = orderChecksByDependency(checks);
  const byId = new Map<number, CheckScore>();
  const results: CheckScore[] = [];
  for (const check of ordered) {
    const scored = await scoreOne(check, { dispatch, ctx, availablePages, byId });
    byId.set(check.diagnosticCheckId, scored);
    results.push(scored);
  }

  // Group non-derived checks by category (preserving first-seen order).
  const groups = new Map<string, { category: AtomicCategory; checks: CheckScore[] }>();
  for (const cs of results) {
    const code = cs.check.category.code;
    const group = groups.get(code);
    if (group) group.checks.push(cs);
    else groups.set(code, { category: cs.check.category, checks: [cs] });
  }

  const categories: ScoredCategory[] = [];
  for (const group of groups.values()) {
    categories.push(rollupCategory(group.category, group.checks));
  }
  // Derived categories (returns_risk): computed from source-check results.
  for (const derived of derivedCategories) {
    categories.push(computeDerivedCategory(derived, byId));
  }

  // Group categories by stage (preserving first-seen order).
  const stageGroups = new Map<string, { stage: AtomicStage; cats: ScoredCategory[] }>();
  for (const sc of categories) {
    const code = sc.category.stage.code;
    const group = stageGroups.get(code);
    if (group) group.cats.push(sc);
    else stageGroups.set(code, { stage: sc.category.stage, cats: [sc] });
  }

  const stages: ScoredStage[] = [];
  for (const group of stageGroups.values()) {
    stages.push(rollupStage(group.stage, group.cats));
  }

  // Overall = mean of the non-null stage scores (each stage equal weight).
  const overall = weightedAverage(stages.map((s) => ({ value: s.score, weight: 1 })));

  return { checks: results, categories, stages, overall };
}
