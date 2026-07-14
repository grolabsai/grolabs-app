/**
 * End-to-end "real signal" milestone: run the REAL seo/aeo scorers through the
 * scoring engine over a small fixture rubric, with discovery-supplied pages and
 * mocked IO (ASE + fetch). Asserts the seo and aeo CATEGORY scores reflect the
 * real measured signal — not stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ase")>();
  return { ...actual, scanPdpSignals: vi.fn() };
});

import { scanPdpSignals } from "@/lib/ase";
import { scoreRun } from "@/lib/diagnostic/v5/engine";
import { getScorer } from "@/lib/diagnostic/v5/registry";
import "@/lib/diagnostic/v5/scorers"; // register real scorers
import type { V5RunContext } from "@/lib/diagnostic/v5/types";
import { makeCategory, makeCheck, makeStage } from "../fixtures";
import { pdp } from "./pdp-fixture";

const ENTRY = "https://shop.example/products/cool-shoe";
const HOME = "https://shop.example";
const mockPdp = vi.mocked(scanPdpSignals);

const discovery = makeStage("discovery", "Discovery");
const seo = makeCategory({ code: "seo", stage: discovery, weight: 45 });
const aeo = makeCategory({ code: "aeo", stage: discovery, weight: 30 });

// A representative slice of the live seed (real check_codes, weights, deps, pages).
const CHECKS = [
  makeCheck({ id: 1, code: "seo.jsonld.present", category: seo, page: "PDP", weight: 8 }),
  makeCheck({ id: 2, code: "seo.jsonld.required_complete", category: seo, page: "PDP", weight: 10, dependsOn: 1 }),
  makeCheck({ id: 3, code: "seo.canonical.present", category: seo, page: "PDP", weight: 4 }),
  makeCheck({ id: 4, code: "seo.sitemap.present", category: seo, page: "SITE_WIDE", weight: 6 }),
  makeCheck({ id: 5, code: "seo.og.image", category: seo, page: "SITE_WIDE", weight: 4 }),
  makeCheck({ id: 10, code: "aeo.llms_txt.present", category: aeo, page: "SITE_WIDE", weight: 10 }),
  makeCheck({ id: 11, code: "aeo.robots.ai_policy", category: aeo, page: "SITE_WIDE", weight: 7 }),
  makeCheck({ id: 12, code: "aeo.faq_schema.present", category: aeo, page: "SITE_WIDE", weight: 3 }),
];

const CTX: V5RunContext = {
  url: ENTRY,
  instanceId: null,
  pages: { PDP: { found: true, url: ENTRY }, SITE_WIDE: { found: true, url: HOME } },
};

beforeEach(() => {
  mockPdp.mockReset();
  mockPdp.mockResolvedValue(
    pdp({
      has_jsonld: true,
      has_product_schema: true, // jsonld.present → pass
      product_schema_fields: ["name", "image", "offers", "description"], // required → 100
      canonical_url: "", // canonical → fail
      has_faqpage_schema: true, // faq_schema.present → pass
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.endsWith("/sitemap.xml")
        ? "<urlset><url><loc>https://shop.example/a</loc></url></urlset>" // present → pass
        : url.endsWith("/llms.txt")
          ? "# Shop\n\nWe sell great products." // present → pass
          : url.endsWith("/robots.txt")
            ? "User-agent: *\nDisallow: /cart" // AI-bots unmentioned → 50
            : `<meta property="og:image" content="https://img/x.jpg">`; // SITE_WIDE html → og:image pass
      return { ok: true, status: 200, text: async () => body } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seo + aeo end-to-end via scoreRun", () => {
  it("produces real category scores from real scorers", async () => {
    const run = await scoreRun({
      checks: CHECKS,
      dispatch: getScorer,
      ctx: CTX,
      availablePages: new Set(["PDP", "SITE_WIDE"]),
    });

    const seoCat = run.categories.find((c) => c.category.code === "seo");
    const aeoCat = run.categories.find((c) => c.category.code === "aeo");

    // SEO: (100·8 + 100·10 + 0·4 + 100·6 + 100·4)/32 = 2800/32 = 87.5 → 88
    expect(seoCat?.score).toBe(88);
    // AEO: (100·10 + 0·7 + 100·3)/20 = 1300/20 = 65
    // (robots unmentioned scores 0 since commit 1589f37, was a neutral 50)
    expect(aeoCat?.score).toBe(65);

    // The discovery stage rolls the two up by category weight:
    // (88·45 + 65·30)/75 = 5910/75 = 78.8 → 79
    expect(run.stages.find((s) => s.stage.code === "discovery")?.score).toBe(79);
  });

  it("excludes a whole category as na when its page was not discovered", async () => {
    const run = await scoreRun({
      checks: CHECKS,
      dispatch: getScorer,
      ctx: { ...CTX, pages: { PDP: { found: true, url: ENTRY }, SITE_WIDE: { found: false } } },
      availablePages: new Set(["PDP"]), // SITE_WIDE undiscovered
    });

    // aeo has only SITE_WIDE checks → every member na → category score null.
    expect(run.categories.find((c) => c.category.code === "aeo")?.score).toBeNull();
    // seo still scores from its PDP checks (sitemap/og are na, excluded):
    // (100·8 + 100·10 + 0·4)/22 = 1800/22 = 81.8 → 82
    expect(run.categories.find((c) => c.category.code === "seo")?.score).toBe(82);
  });
});
