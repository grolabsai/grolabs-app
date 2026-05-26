import { describe, expect, it } from "vitest";
import {
  computeFindingUplift,
  resolveFactors,
  type BenchmarkRow,
} from "@/lib/diagnostic/revenue";

describe("computeFindingUplift", () => {
  it("returns 0 for a perfect-score check (zero headroom)", () => {
    const r = computeFindingUplift({
      traffic: 1_000_000,
      aov: 50,
      baselineCr: 0.02,
      stageShare: 0.25,
      deltaRate: 0.08,
      score: 100,
      resultStatus: "pass",
    });
    expect(r.uplift_usd).toBe(0);
    expect(r.confidence).toBe("high");
  });

  it("leaves residual uplift for a high-but-imperfect score", () => {
    const r = computeFindingUplift({
      traffic: 1_000_000,
      aov: 50,
      baselineCr: 0.02,
      stageShare: 0.25,
      deltaRate: 0.08,
      score: 95,
      resultStatus: "pass",
    });
    // headroom = 0.05; uplift = 1M × .25 × .02 × 50 × .08 × .05 = 1000
    expect(r.uplift_usd).toBeCloseTo(1_000, 0);
  });

  it("returns 0 for na/error findings", () => {
    const r = computeFindingUplift({
      traffic: 1_000_000,
      aov: 50,
      baselineCr: 0.02,
      stageShare: 0.25,
      deltaRate: 0.08,
      score: null,
      resultStatus: "na",
    });
    expect(r.uplift_usd).toBe(0);
    expect(r.confidence).toBe("low");
  });

  it("returns null + missing list when an input is absent", () => {
    const r = computeFindingUplift({
      traffic: null,
      aov: 50,
      baselineCr: 0.02,
      stageShare: 0.25,
      deltaRate: 0.08,
      score: 40,
      resultStatus: "fail",
    });
    expect(r.uplift_usd).toBeNull();
    expect(r.missing_inputs).toContain("traffic");
  });

  it("computes a sane uplift for a partial finding with all inputs", () => {
    // 1M sessions × 25% search-stage × 2% CR × $50 AOV × 8% delta × 0.6 headroom
    // = 1M × 0.25 × 0.02 × 50 × 0.08 × 0.6 = $12,000
    const r = computeFindingUplift({
      traffic: 1_000_000,
      aov: 50,
      baselineCr: 0.02,
      stageShare: 0.25,
      deltaRate: 0.08,
      score: 40,
      resultStatus: "partial",
    });
    expect(r.uplift_usd).toBeCloseTo(12_000, 0);
    expect(r.confidence).toBe("high");
  });
});

describe("resolveFactors", () => {
  const checkBench: BenchmarkRow = {
    vertical_id: 1,
    diagnostic_stage_id: 10,
    diagnostic_check_id: 100,
    baseline_cr: 0.03,
    stage_share: 0.4,
    delta_rate: 0.12,
    default_aov_usd: 75,
  };
  const stageBench: BenchmarkRow = {
    vertical_id: 1,
    diagnostic_stage_id: 10,
    diagnostic_check_id: null,
    baseline_cr: 0.02,
    stage_share: 0.3,
    delta_rate: 0.07,
    default_aov_usd: 60,
  };
  const verticalBench: BenchmarkRow = {
    vertical_id: 1,
    diagnostic_stage_id: null,
    diagnostic_check_id: null,
    baseline_cr: 0.018,
    stage_share: 0.25,
    delta_rate: 0.05,
    default_aov_usd: 45,
  };

  it("prefers check-scoped benchmarks over stage and vertical", () => {
    const f = resolveFactors({
      benchmarks: [checkBench, stageBench, verticalBench],
      checkId: 100,
      stageId: 10,
      prospectAov: null,
      checkDefaultDeltaRate: null,
    });
    expect(f.baselineCr).toBe(0.03);
    expect(f.deltaRate).toBe(0.12);
    expect(f.aov).toBe(75); // default_aov_usd from check benchmark
  });

  it("falls through to stage benchmark when no check-scoped row", () => {
    const f = resolveFactors({
      benchmarks: [stageBench, verticalBench],
      checkId: 999,
      stageId: 10,
      prospectAov: null,
      checkDefaultDeltaRate: null,
    });
    expect(f.baselineCr).toBe(0.02);
    expect(f.stageShare).toBe(0.3);
  });

  it("falls through to vertical-wide when no stage match", () => {
    const f = resolveFactors({
      benchmarks: [verticalBench],
      checkId: 999,
      stageId: 999,
      prospectAov: null,
      checkDefaultDeltaRate: null,
    });
    expect(f.baselineCr).toBe(0.018);
    expect(f.aov).toBe(45);
  });

  it("uses check.default_delta_rate as the final fallback for delta_rate", () => {
    const f = resolveFactors({
      benchmarks: [],
      checkId: 1,
      stageId: 1,
      prospectAov: null,
      checkDefaultDeltaRate: 0.099,
    });
    expect(f.deltaRate).toBe(0.099);
  });

  it("prospect AOV beats benchmark default_aov_usd", () => {
    const f = resolveFactors({
      benchmarks: [verticalBench],
      checkId: 1,
      stageId: 1,
      prospectAov: 88,
      checkDefaultDeltaRate: null,
    });
    expect(f.aov).toBe(88);
  });
});
