import { describe, expect, it } from "vitest";
import { scoreRun } from "@/lib/diagnostic/v5/engine";
import type { CheckScore, V5RunContext } from "@/lib/diagnostic/v5/types";
import {
  dispatchFrom,
  FAIL,
  graded,
  makeCategory,
  makeCheck,
  makeStage,
  PASS,
} from "./fixtures";

const CTX: V5RunContext = { url: "https://shop.example", instanceId: null };

/** Pull one scored check out of a run by code. */
function byCode(checks: CheckScore[], code: string): CheckScore {
  const found = checks.find((c) => c.check.checkCode === code);
  if (!found) throw new Error(`no scored check ${code}`);
  return found;
}

describe("scoreRun — credit-from-zero", () => {
  it("rolls checks into a category, a category into a stage, with na excluded", async () => {
    const seo = makeCategory({ code: "seo", stage: makeStage(), weight: 45 });
    const checks = [
      makeCheck({ id: 1, code: "seo.jsonld.present", category: seo, weight: 8 }),
      makeCheck({ id: 2, code: "seo.jsonld.required_complete", category: seo, weight: 10, dependsOn: 1 }),
      makeCheck({ id: 3, code: "seo.sitemap.present", category: seo, weight: 6 }),
      makeCheck({ id: 4, code: "seo.og.image", category: seo, weight: 4 }), // no scorer → na
    ];
    const dispatch = dispatchFrom({
      "seo.jsonld.present": PASS,
      "seo.jsonld.required_complete": graded(60),
      "seo.sitemap.present": FAIL,
      // seo.og.image intentionally unregistered → na
    });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });

    // og.image is na (excluded). denom = 8+10+6 = 24.
    // earned = 100/100·8 + 60/100·10 + 0·6 = 8 + 6 + 0 = 14 → 14/24·100 = 58
    const seoCat = run.categories.find((c) => c.category.code === "seo");
    expect(seoCat?.score).toBe(58);
    expect(byCode(run.checks, "seo.og.image").status).toBe("na");

    // Single category in the stage → stage score equals category score.
    expect(run.stages).toHaveLength(1);
    expect(run.stages[0].score).toBe(58);
    expect(run.overall).toBe(58);
  });
});

describe("scoreRun — blocked propagation", () => {
  it("blocks every dependent when the prerequisite fails, counting them in the denominator", async () => {
    const search = makeCategory({ code: "internal_search", stage: makeStage("on_site_nav", "Internal search"), weight: 100 });
    const checks = [
      makeCheck({ id: 10, code: "search.box.present", category: search, weight: 12 }),
      makeCheck({ id: 11, code: "search.typo.tolerance", category: search, weight: 10, dependsOn: 10 }),
      makeCheck({ id: 12, code: "search.autocomplete.present", category: search, weight: 5, dependsOn: 10 }),
      makeCheck({ id: 13, code: "search.autocomplete.quality", category: search, weight: 3, dependsOn: 12 }),
    ];
    // The prerequisite fails; dependents have (would-be passing) scorers that
    // must NOT run — they're gated to blocked.
    const dispatch = dispatchFrom({
      "search.box.present": FAIL,
      "search.typo.tolerance": graded(90),
      "search.autocomplete.present": PASS,
      "search.autocomplete.quality": graded(70),
    });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });

    expect(byCode(run.checks, "search.box.present").status).toBe("fail");
    expect(byCode(run.checks, "search.typo.tolerance").status).toBe("blocked");
    expect(byCode(run.checks, "search.autocomplete.present").status).toBe("blocked");
    // Transitive: quality depends on autocomplete.present, which is blocked (unmet).
    const quality = byCode(run.checks, "search.autocomplete.quality");
    expect(quality.status).toBe("blocked");
    expect(quality.score).toBe(0);

    // All blocked/fail, none na → all 30 weight in the denominator, 0 earned.
    expect(run.categories[0].score).toBe(0);
  });

  it("blocks only the failing anchor's subtree, not independent siblings in the same category", async () => {
    // Mixed internal_search category: search.box.present fails, so the checks
    // that DEPEND on it are blocked — but facet.*, search.image.present, and
    // nav.* declare no dependency on it (per the live seed) and must still
    // score. Propagation follows dependency EDGES, never whole categories.
    const search = makeCategory({ code: "internal_search", weight: 100 });
    const checks = [
      makeCheck({ id: 10, code: "search.box.present", category: search, weight: 12 }),
      makeCheck({ id: 11, code: "search.typo.tolerance", category: search, weight: 10, dependsOn: 10 }),
      // Independent siblings — no dependsOn search.box.present.
      makeCheck({ id: 14, code: "facet.present", category: search, weight: 8 }),
      makeCheck({ id: 15, code: "facet.depth", category: search, weight: 5, dependsOn: 14 }),
      makeCheck({ id: 16, code: "search.image.present", category: search, weight: 2 }),
      makeCheck({ id: 17, code: "reco.home.present", category: search, weight: 3 }),
      makeCheck({ id: 18, code: "nav.category.usability", category: search, weight: 6 }),
    ];
    const dispatch = dispatchFrom({
      "search.box.present": FAIL,
      "search.typo.tolerance": graded(90), // gated to blocked — must NOT run
      "facet.present": PASS,
      "facet.depth": PASS,
      "search.image.present": PASS,
      "reco.home.present": graded(40),
      "nav.category.usability": graded(80),
    });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });

    // The search.box subtree is gated.
    expect(byCode(run.checks, "search.box.present").status).toBe("fail");
    expect(byCode(run.checks, "search.typo.tolerance").status).toBe("blocked");
    // Independent siblings still score normally — NOT blocked, NOT na.
    expect(byCode(run.checks, "facet.present").status).toBe("pass");
    expect(byCode(run.checks, "facet.depth").status).toBe("pass"); // parent facet.present met
    expect(byCode(run.checks, "search.image.present").status).toBe("pass");
    expect(byCode(run.checks, "reco.home.present").status).toBe("partial");
    expect(byCode(run.checks, "nav.category.usability").status).toBe("partial");

    // denom = 12+10+8+5+2+3+6 = 46; earned = 0+0 + 100·8 + 100·5 + 100·2 +
    // 40·3 + 80·6 = 2100 → 2100/46 = 45.65 → 46. (A category-wide block would
    // have wrongly produced 0.)
    expect(run.categories[0].score).toBe(46);
  });

  it("does NOT block a dependent when the prerequisite is merely partial", async () => {
    const search = makeCategory({ code: "internal_search", weight: 100 });
    const checks = [
      makeCheck({ id: 10, code: "search.box.present", category: search, weight: 10 }),
      makeCheck({ id: 12, code: "search.autocomplete.present", category: search, weight: 10, dependsOn: 10 }),
    ];
    const dispatch = dispatchFrom({
      "search.box.present": graded(50, "partial"), // present, imperfect → met
      "search.autocomplete.present": PASS,
    });
    const run = await scoreRun({ checks, dispatch, ctx: CTX });
    expect(byCode(run.checks, "search.autocomplete.present").status).toBe("pass");
    // (50·10 + 100·10)/20 = 75
    expect(run.categories[0].score).toBe(75);
  });
});

describe("scoreRun — na propagation", () => {
  it("marks a dependent na (not blocked) when the prerequisite itself is na", async () => {
    const search = makeCategory({ code: "internal_search", weight: 100 });
    const checks = [
      makeCheck({ id: 10, code: "search.box.present", category: search, weight: 12 }),
      makeCheck({ id: 11, code: "search.typo.tolerance", category: search, weight: 10, dependsOn: 10 }),
    ];
    // box.present has no scorer → na; the dependent must become na, not blocked.
    const dispatch = dispatchFrom({ "search.typo.tolerance": graded(90) });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });

    expect(byCode(run.checks, "search.box.present").status).toBe("na");
    const typo = byCode(run.checks, "search.typo.tolerance");
    expect(typo.status).toBe("na");
    expect(typo.note).toMatch(/prereq_na/);

    // Every member na → category score null → stage excluded → overall null.
    expect(run.categories[0].score).toBeNull();
    expect(run.stages[0].score).toBeNull();
    expect(run.overall).toBeNull();
  });
});

describe("scoreRun — page availability", () => {
  it("marks checks on undiscovered pages na without running the scorer", async () => {
    const search = makeCategory({ code: "internal_search", weight: 100 });
    const checks = [
      makeCheck({ id: 10, code: "search.box.present", category: search, page: "HOME", weight: 10 }),
      makeCheck({ id: 20, code: "search.empty_state", category: search, page: "SEARCH_RESULTS", weight: 10 }),
    ];
    const dispatch = dispatchFrom({
      "search.box.present": PASS,
      "search.empty_state": graded(80),
    });

    const run = await scoreRun({
      checks,
      dispatch,
      ctx: CTX,
      availablePages: new Set(["HOME"]), // SEARCH_RESULTS not discovered
    });

    expect(byCode(run.checks, "search.box.present").status).toBe("pass");
    const empty = byCode(run.checks, "search.empty_state");
    expect(empty.status).toBe("na");
    expect(empty.note).toBe("page_unavailable");
    // empty_state excluded → category = box.present only = 100
    expect(run.categories[0].score).toBe(100);
  });

  it("does not page-gate when availablePages is omitted (all pages assumed present)", async () => {
    const checks = [makeCheck({ id: 1, code: "seo.x", page: "SEARCH_RESULTS", weight: 10 })];
    const run = await scoreRun({
      checks,
      dispatch: dispatchFrom({ "seo.x": PASS }),
      ctx: CTX,
    });
    expect(byCode(run.checks, "seo.x").status).toBe("pass");
  });
});

describe("scoreRun — derived categories", () => {
  it("computes returns_risk from contributing source checks", async () => {
    const pdp = makeCategory({ code: "pdp_quality", stage: makeStage("pdp", "Decision"), weight: 100 });
    const checks = [
      makeCheck({ id: 101, code: "pdp.attributes.completeness", category: pdp, weight: 24 }),
      makeCheck({ id: 102, code: "pdp.description.quality", category: pdp, weight: 8 }),
      makeCheck({ id: 103, code: "pdp.images.alt_quality", category: pdp, weight: 5 }),
    ];
    const dispatch = dispatchFrom({
      "pdp.attributes.completeness": graded(50),
      "pdp.description.quality": graded(80),
      "pdp.images.alt_quality": { score: null, status: "na" }, // na source
    });

    const returnsRisk = makeCategory({
      code: "returns_risk",
      stage: makeStage("returns", "Return risk"),
      weight: 100,
      isDerived: true,
    });

    const run = await scoreRun({
      checks,
      dispatch,
      ctx: CTX,
      derivedCategories: [
        {
          category: returnsRisk,
          contributions: [
            { sourceCheckId: 101, weight: 45 },
            { sourceCheckId: 102, weight: 30 },
            { sourceCheckId: 103, weight: 25 }, // na → excluded
          ],
        },
      ],
    });

    const derived = run.categories.find((c) => c.category.code === "returns_risk");
    // (50·45 + 80·30)/100 over denom 75 = (22.5 + 24)/75·100 = 62
    expect(derived?.score).toBe(62);
    expect(derived?.isDerived).toBe(true);

    // The derived category lands in its own stage ('returns').
    const returnsStage = run.stages.find((s) => s.stage.code === "returns");
    expect(returnsStage?.score).toBe(62);
  });
});

describe("scoreRun — scorer failures", () => {
  it("captures a thrown scorer as na rather than crashing the run", async () => {
    const checks = [
      makeCheck({ id: 1, code: "seo.boom", weight: 10 }),
      makeCheck({ id: 2, code: "seo.ok", weight: 10 }),
    ];
    const dispatch = dispatchFrom({ "seo.boom": null, "seo.ok": PASS });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });

    const boom = byCode(run.checks, "seo.boom");
    expect(boom.status).toBe("na");
    expect(boom.note).toMatch(/^error:/);
    // boom excluded → category = ok only = 100
    expect(run.categories[0].score).toBe(100);
  });
});

describe("scoreRun — overall", () => {
  it("averages stage scores with equal weight", async () => {
    const seo = makeCategory({ code: "seo", stage: makeStage("discovery", "Discovery"), weight: 100 });
    const pdp = makeCategory({ code: "pdp_quality", stage: makeStage("pdp", "Decision"), weight: 100 });
    const checks = [
      makeCheck({ id: 1, code: "seo.a", category: seo, weight: 10 }),
      makeCheck({ id: 2, code: "pdp.a", category: pdp, weight: 10 }),
    ];
    const dispatch = dispatchFrom({ "seo.a": graded(80), "pdp.a": graded(40) });

    const run = await scoreRun({ checks, dispatch, ctx: CTX });
    // discovery stage = 80, pdp stage = 40 → overall mean = 60
    expect(run.overall).toBe(60);
  });
});
