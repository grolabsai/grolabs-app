import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectSearchEngine,
  discoverPages,
  pageTypesFromChecks,
  browserProbeEnabled,
  type DiscoveryDeps,
} from "@/lib/diagnostic/v5/discovery";
import { scoreRun } from "@/lib/diagnostic/v5/engine";
import type { V5RunContext } from "@/lib/diagnostic/v5/types";
import type { SiteSignals } from "@/lib/ase";
import type { SiteWideContext } from "@/lib/diagnostic/types";
import type { DiscoveredSamples } from "@/lib/diagnostic/sample-discovery";
import { dispatchFrom, graded, makeCategory, makeCheck, PASS } from "./fixtures";

const ENTRY = "https://shop.example/products/cool-shoe";
const HOME = "https://shop.example";

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeFetch(html: string, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      text: async () => html,
    }) as unknown as Response) as unknown as typeof fetch;
}

function fakeSamples(over: Partial<DiscoveredSamples> = {}): DiscoveredSamples {
  return {
    pdpUrl: null,
    pdpReason: "n/a",
    categoryUrl: `${HOME}/collections/shoes`,
    categoryReason: "homepage_first_category_link",
    homepageText: "",
    homepageHints: {},
    logoUrl: null,
    logoSource: null,
    ...over,
  };
}

function fakeSiteWide(over: Partial<SiteWideContext> = {}): SiteWideContext {
  return {
    rootUrl: HOME,
    llmsTxt: { present: false, status: 404, bodyExcerpt: null },
    robotsTxt: { present: true, status: 200, bodyExcerpt: "User-agent: *", aiBotPolicy: "unmentioned" },
    sitemap: { present: true, status: 200, urlCount: 42 },
    ...over,
  };
}

function fakeSignals(over: Partial<SiteSignals> = {}): SiteSignals {
  return {
    url: HOME,
    platform_detected: "shopify",
    engine_detected: "algolia",
    has_search_box: true,
    facet_count: 3,
    facet_labels: [],
    has_counts: true,
    ...over,
  };
}

function deps(over: Partial<DiscoveryDeps> = {}): Partial<DiscoveryDeps> {
  return {
    fetchImpl: fakeFetch(
      `<html><body>
         <form role="search" action="/search"><input type="search" name="q"></form>
         <a href="/account">My account</a>
         <a href="/collections/shoes">Shoes</a>
       </body></html>`,
    ),
    discoverSamples: async () => fakeSamples(),
    probeSiteWide: async () => fakeSiteWide(),
    scanSiteSignals: async () => fakeSignals(),
    browserEngineFingerprint: null,
    ...over,
  };
}

const ALL_PAGE_TYPES = [
  { code: "PDP", discoveryHint: "the submitted URL" },
  { code: "HOME", discoveryHint: "strip the submitted URL to its root" },
  { code: "SITE_WIDE", discoveryHint: "root domain: robots.txt / sitemap.xml / llms.txt" },
  { code: "CATEGORY", discoveryHint: "follow a category / collection link" },
  { code: "SEARCH_RESULTS", discoveryHint: "trigger a search from the home page" },
  { code: "LOGIN", discoveryHint: "discover login/account link; ask the user if not found" },
];

// ── Page discovery resolves each page_type from its hint ──────────────────────

describe("discoverPages — resolves each page_type", () => {
  it("locates PDP, HOME, SITE_WIDE, CATEGORY, SEARCH_RESULTS and LOGIN", async () => {
    const r = await discoverPages(
      { entryUrl: ENTRY, instanceId: null, pageTypes: ALL_PAGE_TYPES },
      deps(),
    );

    expect(r.homeUrl).toBe(HOME);

    // PDP-first: the submitted URL is the product page.
    expect(r.pages.PDP).toMatchObject({ found: true, url: ENTRY });
    // HOME: root of the PDP.
    expect(r.pages.HOME).toMatchObject({ found: true, url: HOME });
    // SITE_WIDE: root domain reachable (robots/sitemap present).
    expect(r.pages.SITE_WIDE.found).toBe(true);
    // CATEGORY: from the homepage link scraper (reused).
    expect(r.pages.CATEGORY).toMatchObject({
      found: true,
      url: `${HOME}/collections/shoes`,
    });
    // SEARCH_RESULTS: search form on the homepage → results endpoint.
    expect(r.pages.SEARCH_RESULTS).toMatchObject({ found: true });
    expect(r.pages.SEARCH_RESULTS.url).toBe(`${HOME}/search`);
    // LOGIN: account link on the homepage.
    expect(r.pages.LOGIN).toMatchObject({ found: true, url: `${HOME}/account` });

    // availablePages = the found codes, ready for the engine.
    expect([...r.availablePages].sort()).toEqual(
      ["CATEGORY", "HOME", "LOGIN", "PDP", "SEARCH_RESULTS", "SITE_WIDE"].sort(),
    );

    // The DB hint travels into evidence (DB-as-truth, for the report).
    expect(r.pages.SITE_WIDE.evidence?.discovery_hint).toMatch(/robots/);
  });

  it("only resolves the page_types it is given (DB-as-truth, no hardcoded set)", async () => {
    const r = await discoverPages(
      {
        entryUrl: ENTRY,
        instanceId: 0,
        pageTypes: [{ code: "PDP", discoveryHint: null }],
      },
      deps(),
    );
    expect(Object.keys(r.pages)).toEqual(["PDP"]);
  });

  it("falls back to a platform-shaped search endpoint when ASE flags a box but no form exists", async () => {
    const r = await discoverPages(
      { entryUrl: ENTRY, instanceId: null, pageTypes: [{ code: "SEARCH_RESULTS", discoveryHint: null }] },
      deps({
        fetchImpl: fakeFetch("<html><body>no form here</body></html>"),
        scanSiteSignals: async () => fakeSignals({ platform_detected: "shopify", has_search_box: true }),
      }),
    );
    expect(r.pages.SEARCH_RESULTS).toMatchObject({ found: true, url: `${HOME}/search` });
    expect(r.pages.SEARCH_RESULTS.evidence?.via).toBe("ase_has_search_box_platform_guess");
  });

  it("marks CART/CHECKOUT not-found (out of the anonymous profile)", async () => {
    const r = await discoverPages(
      {
        entryUrl: ENTRY,
        instanceId: null,
        pageTypes: [
          { code: "CART", discoveryHint: null },
          { code: "CHECKOUT", discoveryHint: null },
        ],
      },
      deps(),
    );
    expect(r.pages.CART.found).toBe(false);
    expect(r.pages.CHECKOUT.found).toBe(false);
    expect(r.availablePages.size).toBe(0);
  });
});

// ── Missing LOGIN → engine yields 'na' for auth.* (asserted via the engine) ───

describe("discoverPages → engine integration", () => {
  it("an undiscovered LOGIN page makes the engine score auth.* checks na (not blocked)", async () => {
    // Homepage with NO login/account link → LOGIN not found. A SITE_WIDE check
    // (auth.gating.browse lives there in the seed) must still score.
    const r = await discoverPages(
      {
        entryUrl: ENTRY,
        instanceId: null,
        pageTypes: [
          { code: "LOGIN", discoveryHint: null },
          { code: "SITE_WIDE", discoveryHint: null },
        ],
      },
      deps({ fetchImpl: fakeFetch("<html><body>no account link</body></html>") }),
    );
    expect(r.pages.LOGIN.found).toBe(false);
    expect(r.pages.SITE_WIDE.found).toBe(true);

    const auth = makeCategory({ code: "authentication", weight: 100 });
    const checks = [
      makeCheck({ id: 1, code: "auth.sso.google", category: auth, page: "LOGIN", weight: 18 }),
      makeCheck({ id: 2, code: "auth.sso.apple", category: auth, page: "LOGIN", weight: 14 }),
      makeCheck({ id: 3, code: "auth.gating.browse", category: auth, page: "SITE_WIDE", weight: 30 }),
    ];
    const ctx: V5RunContext = {
      url: ENTRY,
      instanceId: null,
      pages: r.pages,
      searchEngine: r.searchEngine,
    };
    const run = await scoreRun({
      checks,
      dispatch: dispatchFrom({
        "auth.sso.google": PASS, // gated to na — must not run
        "auth.sso.apple": PASS,
        "auth.gating.browse": graded(60),
      }),
      ctx,
      availablePages: r.availablePages,
    });

    const byCode = (c: string) => run.checks.find((x) => x.check.checkCode === c)!;
    expect(byCode("auth.sso.google").status).toBe("na");
    expect(byCode("auth.sso.google").note).toBe("page_unavailable");
    expect(byCode("auth.sso.apple").status).toBe("na");
    // The SITE_WIDE check is on a discovered page → it scores normally.
    expect(byCode("auth.gating.browse").status).toBe("partial");
    // Category = the one scorable check only (the two LOGIN checks excluded).
    expect(run.categories[0].score).toBe(60);
  });
});

// ── Search-engine identification ──────────────────────────────────────────────

describe("detectSearchEngine", () => {
  it("identifies Algolia from homepage HTML when ASE and browser are silent", () => {
    const id = detectSearchEngine({
      homepageHtml: `<script src="https://x.algolia.net/1/indexes"></script>`,
      siteSignals: null,
      browserEngineFingerprint: null,
    });
    expect(id.engine).toBe("algolia");
    expect(id.source).toBe("homepage_html");
    expect(id.confidence).toBe("low");
  });

  it("buckets a native engine from ASE site-signals", () => {
    const id = detectSearchEngine({
      homepageHtml: "",
      siteSignals: fakeSignals({ engine_detected: "woocommerce_native" }),
      browserEngineFingerprint: null,
    });
    expect(id.engine).toBe("native");
    expect(id.raw).toBe("woocommerce_native");
    expect(id.source).toBe("ase_site_signals");
    expect(id.confidence).toBe("medium");
  });

  it("returns unknown when nothing fingerprints the engine", () => {
    const id = detectSearchEngine({
      homepageHtml: "<html><body>plain shop</body></html>",
      siteSignals: null,
      browserEngineFingerprint: null,
    });
    expect(id.engine).toBe("unknown");
    expect(id.raw).toBeNull();
    expect(id.source).toBe("none");
    expect(id.confidence).toBe("none");
  });

  it("a browser network fingerprint outranks ASE (high confidence)", () => {
    const id = detectSearchEngine({
      homepageHtml: "",
      siteSignals: fakeSignals({ engine_detected: "woocommerce_native" }),
      browserEngineFingerprint: "algolia",
    });
    expect(id.engine).toBe("algolia");
    expect(id.source).toBe("browser_network");
    expect(id.confidence).toBe("high");
  });
});

// ── Browser-flag-off degradation ──────────────────────────────────────────────

describe("browser-flag-off degradation", () => {
  const saved = {
    enabled: process.env.PROSPECTOS_BROWSER_PROBE_ENABLED,
    host: process.env.BROWSERLESS_HOST,
    token: process.env.BROWSERLESS_TOKEN,
  };
  beforeEach(() => {
    delete process.env.PROSPECTOS_BROWSER_PROBE_ENABLED;
    delete process.env.BROWSERLESS_HOST;
    delete process.env.BROWSERLESS_TOKEN;
  });
  afterEach(() => {
    if (saved.enabled === undefined) delete process.env.PROSPECTOS_BROWSER_PROBE_ENABLED;
    else process.env.PROSPECTOS_BROWSER_PROBE_ENABLED = saved.enabled;
    if (saved.host === undefined) delete process.env.BROWSERLESS_HOST;
    else process.env.BROWSERLESS_HOST = saved.host;
    if (saved.token === undefined) delete process.env.BROWSERLESS_TOKEN;
    else process.env.BROWSERLESS_TOKEN = saved.token;
  });

  it("browserProbeEnabled() is false without the flag + Browserless vars", () => {
    expect(browserProbeEnabled()).toBe(false);
  });

  it("discovery still resolves pages and the engine via fetch + ASE when the browser is off", async () => {
    const r = await discoverPages(
      { entryUrl: ENTRY, instanceId: null, pageTypes: ALL_PAGE_TYPES },
      deps({ browserEngineFingerprint: null }), // no browser signal
    );
    // Pages still discovered statically.
    expect(r.pages.HOME.found).toBe(true);
    expect(r.pages.CATEGORY.found).toBe(true);
    expect(r.pages.SEARCH_RESULTS.found).toBe(true);
    // Engine still identified — from ASE (medium), not the browser.
    expect(r.searchEngine.source).toBe("ase_site_signals");
    expect(r.searchEngine.engine).toBe("algolia");
  });

  it("degrades to not-found when ASE is down and the homepage fetch fails", async () => {
    const r = await discoverPages(
      { entryUrl: ENTRY, instanceId: null, pageTypes: ALL_PAGE_TYPES },
      deps({
        fetchImpl: fakeFetch("", false, null as unknown as number),
        discoverSamples: async () => fakeSamples({ categoryUrl: null, categoryReason: "homepage_fetch_failed" }),
        probeSiteWide: async () => null,
        scanSiteSignals: async () => null,
      }),
    );
    expect(r.pages.HOME.found).toBe(false);
    expect(r.pages.SITE_WIDE.found).toBe(false);
    expect(r.pages.CATEGORY.found).toBe(false);
    expect(r.pages.SEARCH_RESULTS.found).toBe(false);
    expect(r.pages.LOGIN.found).toBe(false);
    // PDP is the submitted URL — always present.
    expect(r.pages.PDP.found).toBe(true);
    expect(r.searchEngine.engine).toBe("unknown");
  });
});

// ── pageTypesFromChecks (DB-as-truth helper) ──────────────────────────────────

describe("pageTypesFromChecks", () => {
  it("derives the distinct page_types from the loaded checks, deduped", () => {
    const cat = makeCategory({ code: "seo", weight: 100 });
    const checks = [
      makeCheck({ id: 1, code: "seo.a", category: cat, page: "PDP" }),
      makeCheck({ id: 2, code: "seo.b", category: cat, page: "PDP" }),
      makeCheck({ id: 3, code: "seo.c", category: cat, page: "SITE_WIDE" }),
    ];
    const pts = pageTypesFromChecks(checks);
    expect(pts.map((p) => p.code).sort()).toEqual(["PDP", "SITE_WIDE"]);
  });
});
