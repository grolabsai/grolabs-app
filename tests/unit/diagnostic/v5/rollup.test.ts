import { describe, expect, it } from "vitest";
import {
  computeDerivedCategory,
  creditFromZero,
  rollupCategory,
  rollupStage,
  weightedAverage,
} from "@/lib/diagnostic/v5/rollup";
import type { CheckScore } from "@/lib/diagnostic/v5/types";
import { makeCategory, makeCheck } from "./fixtures";

/**
 * Pure roll-up math. These pin the locked credit-from-zero semantics in
 * isolation (the engine.test.ts walk exercises them end-to-end).
 */
describe("creditFromZero", () => {
  it("weights earned credit and divides by non-na weight", () => {
    // (100/100·8) + (60/100·10) + (0·6) = 14 ; denom 8+10+6 = 24 → 58.33 → 58
    const score = creditFromZero([
      { score: 100, status: "pass", weight: 8 },
      { score: 60, status: "partial", weight: 10 },
      { score: 0, status: "fail", weight: 6 },
    ]);
    expect(score).toBe(58);
  });

  it("excludes na members from BOTH numerator and denominator", () => {
    // na (weight 6) dropped → (100·8)/100 over denom 8 = 100
    const score = creditFromZero([
      { score: 100, status: "pass", weight: 8 },
      { score: null, status: "na", weight: 6 },
    ]);
    expect(score).toBe(100);
  });

  it("counts blocked members as 0 IN the denominator", () => {
    // earned 0 ; denom 12+10 = 22 → 0
    expect(
      creditFromZero([
        { score: 0, status: "fail", weight: 12 },
        { score: 0, status: "blocked", weight: 10 },
      ]),
    ).toBe(0);
  });

  it("blocked drags the score vs the same group with the member na", () => {
    const withBlocked = creditFromZero([
      { score: 100, status: "pass", weight: 10 },
      { score: 0, status: "blocked", weight: 10 },
    ]);
    const withNa = creditFromZero([
      { score: 100, status: "pass", weight: 10 },
      { score: null, status: "na", weight: 10 },
    ]);
    expect(withBlocked).toBe(50); // (10)/20·100
    expect(withNa).toBe(100); // na excluded
  });

  it("returns null when every member is na", () => {
    expect(
      creditFromZero([
        { score: null, status: "na", weight: 4 },
        { score: null, status: "na", weight: 9 },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty group", () => {
    expect(creditFromZero([])).toBeNull();
  });
});

describe("weightedAverage", () => {
  it("averages non-null values by weight", () => {
    // (45·45 + 30·90 + 25·0) wait — use category-style: value·weight
    // (90·45 + 60·30 + 0·25) / (45+30+25) = (4050+1800+0)/100 = 58.5 → 59
    expect(
      weightedAverage([
        { value: 90, weight: 45 },
        { value: 60, weight: 30 },
        { value: 0, weight: 25 },
      ]),
    ).toBe(59);
  });

  it("skips null values (excluded categories)", () => {
    // (80·45 + null·30) / 45 = 80
    expect(
      weightedAverage([
        { value: 80, weight: 45 },
        { value: null, weight: 30 },
      ]),
    ).toBe(80);
  });

  it("returns null when all values are null", () => {
    expect(
      weightedAverage([
        { value: null, weight: 1 },
        { value: null, weight: 2 },
      ]),
    ).toBeNull();
  });
});

describe("rollupCategory", () => {
  it("uses each check's own weight (credit-from-zero)", () => {
    const seo = makeCategory({ code: "seo", weight: 45 });
    const checks: CheckScore[] = [
      { check: makeCheck({ id: 1, code: "seo.a", category: seo, weight: 8 }), score: 100, status: "pass" },
      { check: makeCheck({ id: 2, code: "seo.b", category: seo, weight: 10 }), score: 50, status: "partial" },
      { check: makeCheck({ id: 3, code: "seo.c", category: seo, weight: 2 }), score: null, status: "na" },
    ];
    const rolled = rollupCategory(seo, checks);
    // (100·8 + 50·10)/100 over denom 18 = (8 + 5)/18·100 = 72.2 → 72
    expect(rolled.score).toBe(72);
    expect(rolled.isDerived).toBe(false);
  });
});

describe("computeDerivedCategory", () => {
  it("scores returns_risk from contribution edges (credit-from-zero)", () => {
    const byId = new Map<number, CheckScore>([
      [101, { check: makeCheck({ id: 101, code: "pdp.attributes.completeness" }), score: 50, status: "partial" }],
      [102, { check: makeCheck({ id: 102, code: "pdp.description.quality" }), score: 80, status: "partial" }],
      [103, { check: makeCheck({ id: 103, code: "pdp.images.alt_quality" }), score: null, status: "na" }],
    ]);
    const returnsRisk = makeCategory({ code: "returns_risk", weight: 100, isDerived: true });
    const rolled = computeDerivedCategory(
      {
        category: returnsRisk,
        contributions: [
          { sourceCheckId: 101, weight: 45 },
          { sourceCheckId: 102, weight: 30 },
          { sourceCheckId: 103, weight: 25 }, // na source → excluded
        ],
      },
      byId,
    );
    // (50·45 + 80·30)/100 over denom 75 = (22.5 + 24)/75·100 = 62
    expect(rolled.score).toBe(62);
    expect(rolled.isDerived).toBe(true);
    expect(rolled.checks).toEqual([]);
  });

  it("counts a blocked source as 0 in the denominator", () => {
    const byId = new Map<number, CheckScore>([
      [201, { check: makeCheck({ id: 201, code: "src.ok" }), score: 100, status: "pass" }],
      [202, { check: makeCheck({ id: 202, code: "src.blocked" }), score: 0, status: "blocked" }],
    ]);
    const rolled = computeDerivedCategory(
      {
        category: makeCategory({ code: "returns_risk", isDerived: true }),
        contributions: [
          { sourceCheckId: 201, weight: 50 },
          { sourceCheckId: 202, weight: 50 },
        ],
      },
      byId,
    );
    expect(rolled.score).toBe(50); // (100·50)/100 over 100
  });

  it("ignores a contribution whose source check is absent from the run", () => {
    const byId = new Map<number, CheckScore>([
      [301, { check: makeCheck({ id: 301, code: "src.present" }), score: 40, status: "partial" }],
    ]);
    const rolled = computeDerivedCategory(
      {
        category: makeCategory({ code: "returns_risk", isDerived: true }),
        contributions: [
          { sourceCheckId: 301, weight: 50 },
          { sourceCheckId: 999, weight: 50 }, // not in run
        ],
      },
      byId,
    );
    expect(rolled.score).toBe(40); // only the present source counts
  });
});

describe("rollupStage", () => {
  it("averages categories by their stage weight, skipping null categories", () => {
    const stage = { code: "discovery", name: "Discovery" };
    const seo = makeCategory({ code: "seo", weight: 45 });
    const aeo = makeCategory({ code: "aeo", weight: 30 });
    const perf = makeCategory({ code: "page_performance", weight: 25 });
    const rolled = rollupStage(stage, [
      { category: seo, score: 80, isDerived: false, checks: [] },
      { category: aeo, score: 40, isDerived: false, checks: [] },
      { category: perf, score: null, isDerived: false, checks: [] }, // all-na → skipped
    ]);
    // (80·45 + 40·30) / (45+30) = (3600+1200)/75 = 64
    expect(rolled.score).toBe(64);
  });
});
