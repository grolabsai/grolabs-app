import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistScoredRun } from "@/lib/diagnostic/v5/persist";
import type { RevenueResult } from "@/lib/diagnostic/revenue";
import type {
  CheckScore,
  ScoredCategory,
  ScoredRun,
  ScoredStage,
} from "@/lib/diagnostic/v5/types";
import { makeCategory, makeCheck, makeStage } from "./fixtures";

/**
 * Mock supabase recording finding inserts + run_category_score upserts. Each
 * `from(table)` returns a thenable-returning insert/upsert; persist awaits the
 * `{ error }` result.
 */
function makeSupabase(errors: Partial<Record<string, { message: string }>> = {}) {
  const inserted: Record<string, unknown[]> = { finding: [], run_category_score: [] };
  const upsertOpts: Record<string, unknown> = {};
  const client = {
    from(table: string) {
      return {
        insert(rows: unknown[]) {
          inserted[table].push(...rows);
          return Promise.resolve({ error: errors[table] ?? null });
        },
        upsert(rows: unknown[], opts: unknown) {
          inserted[table].push(...rows);
          upsertOpts[table] = opts;
          return Promise.resolve({ error: errors[table] ?? null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserted, upsertOpts };
}

const seo = makeCategory({ code: "seo", stage: makeStage("discovery", "Discovery"), weight: 45 });

function checkScore(over: {
  id: number;
  code: string;
  score: number | null;
  status: CheckScore["status"];
  weight?: number;
  findingClass?: CheckScore["check"]["findingClass"];
  evidence?: Record<string, unknown>;
  note?: string;
}): CheckScore {
  return {
    check: makeCheck({
      id: over.id,
      code: over.code,
      category: seo,
      weight: over.weight ?? 10,
      findingClass: over.findingClass ?? "revenue_leak",
    }),
    score: over.score,
    status: over.status,
    evidence: over.evidence,
    note: over.note,
  };
}

/** Build a minimal ScoredRun from a list of CheckScores in one category. */
function scoredRunOf(checks: CheckScore[], categoryScore: number | null): ScoredRun {
  const category: ScoredCategory = { category: seo, score: categoryScore, isDerived: false, checks };
  const stage: ScoredStage = { stage: seo.stage, score: categoryScore, categories: [category] };
  return { checks, categories: [category], stages: [stage], overall: categoryScore };
}

const CAT_IDS = new Map<string, number>([["seo", 500]]);

describe("persistScoredRun — finding rows", () => {
  it("writes one finding per check with the right status, score, and finding_class in evidence", async () => {
    const checks = [
      checkScore({ id: 1, code: "seo.a", score: 100, status: "pass", findingClass: "revenue_leak", evidence: { foo: "bar" } }),
      checkScore({ id: 2, code: "seo.b", score: 0, status: "blocked", note: "blocked_by:seo.a" }),
      checkScore({ id: 3, code: "seo.c", score: null, status: "na", findingClass: "value_prop" }),
      checkScore({ id: 4, code: "seo.d", score: 62.4, status: "partial" }), // fractional → rounded
    ];
    const { client, inserted } = makeSupabase();

    const result = await persistScoredRun({
      supabase: client,
      runId: "run-123",
      instanceId: 0, // template instance — a REAL id, must not collapse to null
      scored: scoredRunOf(checks, 58),
      categoryIdByCode: CAT_IDS,
    });

    expect(result.findingsInserted).toBe(4);
    const rows = inserted.finding as Record<string, unknown>[];

    expect(rows[0]).toMatchObject({
      run_id: "run-123",
      instance_id: 0,
      diagnostic_check_id: 1,
      score: 100,
      result_status: "pass",
      evidence: { foo: "bar", finding_class: "revenue_leak" },
    });
    // blocked → score 0, status blocked, note preserved
    expect(rows[1]).toMatchObject({ diagnostic_check_id: 2, score: 0, result_status: "blocked", notes: "blocked_by:seo.a" });
    // na → score null, finding_class still mirrored into evidence
    expect(rows[2]).toMatchObject({ diagnostic_check_id: 3, score: null, result_status: "na", evidence: { finding_class: "value_prop" } });
    // fractional graded score rounded for the int column
    expect(rows[3]).toMatchObject({ diagnostic_check_id: 4, score: 62 });
  });

  it("writes instance_id null verbatim for an anonymous run", async () => {
    const { client, inserted } = makeSupabase();
    await persistScoredRun({
      supabase: client,
      runId: "run-anon",
      instanceId: null,
      scored: scoredRunOf([checkScore({ id: 1, code: "seo.a", score: 100, status: "pass" })], 100),
      categoryIdByCode: CAT_IDS,
    });
    expect((inserted.finding[0] as Record<string, unknown>).instance_id).toBeNull();
    expect((inserted.run_category_score[0] as Record<string, unknown>).instance_id).toBeNull();
  });
});

describe("persistScoredRun — run_category_score", () => {
  it("upserts one row per category with the category score and the right conflict target", async () => {
    const checks = [checkScore({ id: 1, code: "seo.a", score: 100, status: "pass" })];
    const { client, inserted, upsertOpts } = makeSupabase();

    const result = await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: scoredRunOf(checks, 58),
      categoryIdByCode: CAT_IDS,
    });

    expect(result.categoryScoresUpserted).toBe(1);
    expect(inserted.run_category_score[0]).toMatchObject({
      run_id: "run-1",
      instance_id: 7,
      diagnostic_category_id: 500,
      score: 58,
    });
    expect(upsertOpts.run_category_score).toEqual({ onConflict: "run_id,diagnostic_category_id" });
  });

  it("skips a category whose id is not resolvable, reporting it", async () => {
    const checks = [checkScore({ id: 1, code: "seo.a", score: 100, status: "pass" })];
    const { client, inserted } = makeSupabase();

    const result = await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: scoredRunOf(checks, 58),
      categoryIdByCode: new Map(), // no id for "seo"
    });

    expect(result.categoryScoresUpserted).toBe(0);
    expect(result.skippedCategories).toEqual(["seo"]);
    expect(inserted.run_category_score).toHaveLength(0);
    // findings still written
    expect(inserted.finding).toHaveLength(1);
  });
});

describe("persistScoredRun — uplift", () => {
  const upliftFn = (factors: Record<string, RevenueResult>) =>
    (input: { check: { checkCode: string } }) =>
      factors[input.check.checkCode] ?? { uplift_usd: 0, confidence: "high" as const, missing_inputs: [] };

  it("sums per-check uplift into the category and carries it onto findings", async () => {
    const checks = [
      checkScore({ id: 1, code: "seo.a", score: 0, status: "fail" }),
      checkScore({ id: 2, code: "seo.b", score: 50, status: "partial" }),
      checkScore({ id: 3, code: "seo.c", score: null, status: "na" }), // na → 0 uplift, ignored
    ];
    const { client, inserted } = makeSupabase();

    await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: scoredRunOf(checks, 25),
      categoryIdByCode: CAT_IDS,
      checkUplift: upliftFn({
        "seo.a": { uplift_usd: 1000, confidence: "high", missing_inputs: [] },
        "seo.b": { uplift_usd: 250.5, confidence: "medium", missing_inputs: [] },
        "seo.c": { uplift_usd: 0, confidence: "low", missing_inputs: [] },
      }),
    });

    // category sum = 1000 + 250.5 (na member skipped) = 1250.5 ; min confidence = medium
    expect(inserted.run_category_score[0]).toMatchObject({
      est_annual_uplift_usd: 1250.5,
      est_confidence: "medium",
    });
    // per-finding uplift mirrored onto the finding row
    expect((inserted.finding[0] as Record<string, unknown>).est_annual_uplift_usd).toBe(1000);
    expect((inserted.finding[1] as Record<string, unknown>).est_confidence).toBe("medium");
  });

  it("collapses the category uplift to null when any scoreable member is missing a factor", async () => {
    const checks = [
      checkScore({ id: 1, code: "seo.a", score: 0, status: "fail" }),
      checkScore({ id: 2, code: "seo.b", score: 0, status: "fail" }),
    ];
    const { client, inserted } = makeSupabase();

    await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: scoredRunOf(checks, 0),
      categoryIdByCode: CAT_IDS,
      checkUplift: upliftFn({
        "seo.a": { uplift_usd: 1000, confidence: "high", missing_inputs: [] },
        "seo.b": { uplift_usd: null, confidence: "low", missing_inputs: ["traffic"] },
      }),
    });

    expect((inserted.run_category_score[0] as Record<string, unknown>).est_annual_uplift_usd).toBeNull();
  });

  it("leaves uplift null when no uplift function is supplied", async () => {
    const { client, inserted } = makeSupabase();
    await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: scoredRunOf([checkScore({ id: 1, code: "seo.a", score: 100, status: "pass" })], 100),
      categoryIdByCode: CAT_IDS,
    });
    const cat = inserted.run_category_score[0] as Record<string, unknown>;
    expect(cat.est_annual_uplift_usd).toBeNull();
    expect(cat.est_confidence).toBeNull();
  });

  it("leaves derived-category uplift null to avoid double-counting", async () => {
    const derived: ScoredCategory = {
      category: makeCategory({ code: "returns_risk", stage: makeStage("returns", "Return risk"), weight: 100, isDerived: true }),
      score: 62,
      isDerived: true,
      checks: [],
    };
    const run: ScoredRun = {
      checks: [],
      categories: [derived],
      stages: [{ stage: derived.category.stage, score: 62, categories: [derived] }],
      overall: 62,
    };
    const { client, inserted } = makeSupabase();
    await persistScoredRun({
      supabase: client,
      runId: "run-1",
      instanceId: 7,
      scored: run,
      categoryIdByCode: new Map([["returns_risk", 900]]),
      checkUplift: () => ({ uplift_usd: 5000, confidence: "high", missing_inputs: [] }),
    });
    const cat = inserted.run_category_score[0] as Record<string, unknown>;
    expect(cat.diagnostic_category_id).toBe(900);
    expect(cat.score).toBe(62);
    expect(cat.est_annual_uplift_usd).toBeNull();
  });
});

describe("persistScoredRun — errors", () => {
  it("throws when the finding insert fails", async () => {
    const { client } = makeSupabase({ finding: { message: "boom" } });
    await expect(
      persistScoredRun({
        supabase: client,
        runId: "run-1",
        instanceId: 7,
        scored: scoredRunOf([checkScore({ id: 1, code: "seo.a", score: 100, status: "pass" })], 100),
        categoryIdByCode: CAT_IDS,
      }),
    ).rejects.toThrow(/finding insert failed: boom/);
  });
});
