import { describe, expect, it } from "vitest";
import {
  getScorer,
  register,
  registeredCheckCodes,
  notImplemented,
} from "@/lib/diagnostic/v5";
import type { AtomicCheck, V5RunContext } from "@/lib/diagnostic/v5";

/**
 * Registry coverage + dispatch tests.
 *
 * The expected set is pinned here (in the TEST, not the loader) so a missing or
 * stray stub fails loudly. This is the dispatch contract — distinct from the
 * DB-as-truth rubric, which the loader reads from the database. The list must
 * match the 55 atomic checks seeded at instance 0
 * (migration 20260605000006).
 */
const EXPECTED_CODES: string[] = [
  // seo (9)
  "seo.jsonld.present",
  "seo.jsonld.required_complete",
  "seo.jsonld.bonus",
  "seo.sitemap.present",
  "seo.sitemap.valid",
  "seo.og.title",
  "seo.og.description",
  "seo.og.image",
  "seo.canonical.present",
  // aeo (5)
  "aeo.llms_txt.present",
  "aeo.llms_txt.quality",
  "aeo.robots.ai_policy",
  "aeo.faq_schema.present",
  "aeo.answerable.structure",
  // perf (3)
  "perf.cwv.lcp",
  "perf.cwv.inp",
  "perf.cwv.cls",
  // internal_search (19)
  "search.box.present",
  "search.speed.latency",
  "search.typo.tolerance",
  "search.synonym.coverage",
  "search.autocomplete.present",
  "search.autocomplete.quality",
  "search.semantic.present",
  "search.conversational.present",
  "search.image.present",
  "search.recent.persistence",
  "search.empty_state",
  "search.brand_relevance",
  "reco.home.present",
  "reco.home.quality",
  "facet.present",
  "facet.depth",
  "nav.category.usability",
  "nav.tags.present",
  "nav.breadcrumb.present",
  // pdp_quality (11) + data_completeness (2)
  "pdp.images.present",
  "pdp.images.count",
  "pdp.images.alt_quality",
  "pdp.variants.present",
  "pdp.variants.clarity",
  "pdp.description.present",
  "pdp.description.quality",
  "pdp.reviews.present",
  "pdp.stock.clarity",
  "pdp.crosssell.present",
  "pdp.upsell.present",
  "pdp.attributes.present",
  "pdp.attributes.completeness",
  // authentication (6)
  "auth.gating.browse",
  "auth.mobile.login_overlay",
  "auth.sso.google",
  "auth.sso.apple",
  "auth.sso.meta",
  "auth.sso.microsoft",
];

const fakeCheck = { checkCode: "x" } as unknown as AtomicCheck;
const fakeCtx: V5RunContext = { url: "https://example.com", instanceId: null };

describe("v5 scorer registry", () => {
  it("covers exactly the 55 seeded check codes", () => {
    expect(EXPECTED_CODES).toHaveLength(55);
    const registered = new Set(registeredCheckCodes());
    for (const code of EXPECTED_CODES) {
      expect(getScorer(code), `missing scorer for ${code}`).toBeTypeOf(
        "function",
      );
    }
    // No stray registrations from the real scorer files (the `test.*` sentinels
    // come from the register/lookup tests below and are ignored here, so this
    // assertion is independent of test execution order).
    const stray = [...registered].filter(
      (c) => !EXPECTED_CODES.includes(c) && !c.startsWith("test."),
    );
    expect(stray).toEqual([]);
  });

  it("returns undefined for an unknown code", () => {
    expect(getScorer("does.not.exist")).toBeUndefined();
  });

  it("every stub returns a not-measured (na) result", async () => {
    const r = await getScorer("seo.jsonld.present")!(fakeCheck, fakeCtx);
    expect(r).toEqual({ score: null, status: "na", note: "not_implemented" });
  });

  it("register adds a code and getScorer retrieves it", async () => {
    const code = "test.only.code";
    expect(getScorer(code)).toBeUndefined();
    register(code, async () => ({ score: 100, status: "pass" }));
    const scorer = getScorer(code);
    expect(scorer).toBeTypeOf("function");
    await expect(scorer!(fakeCheck, fakeCtx)).resolves.toEqual({
      score: 100,
      status: "pass",
    });
  });

  it("notImplemented is the shared stub", async () => {
    await expect(notImplemented(fakeCheck, fakeCtx)).resolves.toEqual({
      score: null,
      status: "na",
      note: "not_implemented",
    });
  });
});
