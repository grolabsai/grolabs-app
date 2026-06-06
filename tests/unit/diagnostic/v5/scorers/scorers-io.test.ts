/**
 * IO/wrapper behavior for the seo/aeo scorers: page resolution, graceful
 * degradation, and per-run memoization. We mock the two real IO boundaries —
 * ASE `scanPdpSignals` and global `fetch` — and drive the REAL registered
 * scorers + evidence layer through them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ase")>();
  return { ...actual, scanPdpSignals: vi.fn() };
});

import { scanPdpSignals } from "@/lib/ase";
import { getScorer } from "@/lib/diagnostic/v5/registry";
import "@/lib/diagnostic/v5/scorers"; // side effect: register real scorers
import type { V5RunContext, DiscoveredPages } from "@/lib/diagnostic/v5/types";
import { makeCheck } from "../fixtures";
import { pdp } from "./pdp-fixture";

const ENTRY = "https://shop.example/products/cool-shoe";
const HOME = "https://shop.example";
const mockPdp = vi.mocked(scanPdpSignals);

/** Build a run context with the given discovered pages. */
function ctxWith(pages: DiscoveredPages): V5RunContext {
  return { url: ENTRY, instanceId: null, pages };
}

const PDP_OK = { PDP: { found: true, url: ENTRY }, SITE_WIDE: { found: true, url: HOME } };

/** Run the registered scorer for `code` against a context. */
async function run(code: string, ctx: V5RunContext) {
  const scorer = getScorer(code);
  if (!scorer) throw new Error(`no scorer ${code}`);
  return scorer(makeCheck({ id: 1, code }), ctx);
}

/** A fetch stub that routes by URL suffix. Throwing routes simulate timeouts. */
function stubFetch(router: (url: string) => { ok: boolean; status: number; body: string } | "throw") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const r = router(url);
      if (r === "throw") throw new Error("network down");
      return { ok: r.ok, status: r.status, text: async () => r.body } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  mockPdp.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ASE_PDP scorers — page resolution + graceful failure", () => {
  it("returns na (without calling ASE) when the PDP was not discovered", async () => {
    const ctx = ctxWith({ PDP: { found: false }, SITE_WIDE: { found: true, url: HOME } });
    const r = await run("seo.jsonld.present", ctx);
    expect(r.status).toBe("na");
    expect(r.note).toBe("pdp_page_unavailable");
    expect(mockPdp).not.toHaveBeenCalled();
  });

  it("returns na when the ASE call fails", async () => {
    mockPdp.mockRejectedValue(new Error("ASE 500"));
    const r = await run("seo.jsonld.present", ctxWith(PDP_OK));
    expect(r.status).toBe("na");
    expect(r.note).toMatch(/^ase_pdp_failed:/);
  });

  it("scores from real ASE signals when present", async () => {
    mockPdp.mockResolvedValue(pdp({ has_product_schema: true }));
    const r = await run("seo.jsonld.present", ctxWith(PDP_OK));
    expect(r.status).toBe("pass");
    expect(r.score).toBe(100);
  });

  it("memoizes the ASE call across scorers sharing a context", async () => {
    mockPdp.mockResolvedValue(pdp({ has_product_schema: true, canonical_url: HOME }));
    const ctx = ctxWith(PDP_OK);
    await run("seo.jsonld.present", ctx);
    await run("seo.canonical.present", ctx);
    await run("aeo.faq_schema.present", ctx);
    expect(mockPdp).toHaveBeenCalledTimes(1);
  });
});

describe("FETCH scorers — presence, absence, and errors", () => {
  it("seo.sitemap.present passes on 200", async () => {
    stubFetch((u) => (u.endsWith("/sitemap.xml") ? { ok: true, status: 200, body: "<urlset/>" } : "throw"));
    const r = await run("seo.sitemap.present", ctxWith(PDP_OK));
    expect(r.status).toBe("pass");
    expect(r.score).toBe(100);
  });

  it("seo.sitemap.present fails (0) on a 404 — the artifact is genuinely absent", async () => {
    stubFetch(() => ({ ok: false, status: 404, body: "not found" }));
    const r = await run("seo.sitemap.present", ctxWith(PDP_OK));
    expect(r.status).toBe("fail");
    expect(r.score).toBe(0);
  });

  it("seo.sitemap.present returns na on a network error/timeout", async () => {
    stubFetch(() => "throw");
    const r = await run("seo.sitemap.present", ctxWith(PDP_OK));
    expect(r.status).toBe("na");
  });

  it("returns na when SITE_WIDE was not discovered (no fetch attempted)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const ctx = ctxWith({ PDP: { found: true, url: ENTRY }, SITE_WIDE: { found: false } });
    const r = await run("aeo.llms_txt.present", ctx);
    expect(r.status).toBe("na");
    expect(r.note).toBe("site_wide_page_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("seo.og.title parses OG tags from the fetched SITE_WIDE page", async () => {
    stubFetch((u) =>
      u === HOME || u === `${HOME}/`
        ? { ok: true, status: 200, body: `<meta property="og:title" content="Cool Shop">` }
        : "throw",
    );
    const r = await run("seo.og.title", ctxWith(PDP_OK));
    expect(r.status).toBe("pass");
    expect((r.evidence as { value: string }).value).toBe("Cool Shop");
  });

  it("aeo.robots.ai_policy treats a 404 robots.txt as unmentioned (partial)", async () => {
    stubFetch(() => ({ ok: false, status: 404, body: "" }));
    const r = await run("aeo.robots.ai_policy", ctxWith(PDP_OK));
    expect(r.status).toBe("partial");
    expect(r.score).toBe(50);
  });

  it("memoizes the sitemap fetch across present + valid", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "<urlset><url><loc>x</loc></url></urlset>" }) as unknown as Response);
    vi.stubGlobal("fetch", fetchImpl);
    const ctx = ctxWith(PDP_OK);
    await run("seo.sitemap.present", ctx);
    await run("seo.sitemap.valid", ctx);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
