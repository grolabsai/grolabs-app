/**
 * Prospectos v5 — page discovery + search-engine identification (Prompt 4).
 *
 * PDP-FIRST navigation: the submitted URL IS the product page. From it we
 * resolve every OTHER page the loaded rubric needs to score — home, site-wide
 * root, a category, a search-results page, a login page — and we identify the
 * storefront's search engine. Discovery decides WHICH pages/checks are
 * reachable; it does NOT score them (that's Prompt 5).
 *
 * DB-as-truth (CLAUDE.md §5): the SET of pages to resolve is never hardcoded —
 * it is derived from the `page_type`s the loaded checks reference (each
 * `AtomicCheck.pageType`, which the loader read from the DB). `page_code` is the
 * machine key we dispatch on; `discovery_hint` is the DB-authored description of
 * the strategy and travels into evidence. We only resolve codes that appear in
 * the loaded set.
 *
 * BRIDGE / additive (Prompt 4 constraints): this module is NOT wired into any
 * running diagnostic (Prompt 6 does that). It REUSES the existing static-HTML
 * helpers — `discoverSamples` (homepage link scraping), `probeSiteWide`
 * (robots/sitemap/llms), and ASE `scanSiteSignals` (engine + search box) —
 * without touching them. The browser probe is only consulted behind its
 * existing flags; when off we degrade to fetch + ASE, and a page that still
 * can't be located is reported `found:false` (the engine then marks its checks
 * `na` — excluded, never blocked).
 *
 * Multi-tenancy (CLAUDE.md §2): `instanceId` may be `null` (anonymous landing
 * run) and `0` is the real template instance — strict null checks only. The
 * anonymous audit never asks a human anything (no LOGIN prompt): an undiscovered
 * page is simply not-found.
 */

import { discoverSamples, type DiscoveredSamples } from "../sample-discovery";
import { probeSiteWide } from "../site-checks";
import type { SiteWideContext } from "../types";
import { scanSiteSignals, type SiteSignals } from "@/lib/ase";
import type {
  AtomicCheck,
  DiscoveredPage,
  DiscoveredPages,
  SearchEngine,
  SearchEngineId,
} from "./types";

const USER_AGENT = "Mozilla/5.0 (compatible; SiteAuditBot/1.0)";
const TIMEOUT_MS = 8000;

/** A page_type to resolve: its DB `page_code` + the DB-authored hint. */
export type PageTypeRef = {
  code: string;
  discoveryHint: string | null;
};

export type DiscoverPagesInput = {
  /** The submitted URL — treated as the PDP (PDP-first). */
  entryUrl: string;
  /** Resolved instance; `null` = anonymous. `0` is real. */
  instanceId: number | null;
  /**
   * The page_types the rubric references (DB-as-truth — derive from the loaded
   * checks via `pageTypesFromChecks`, never a hardcoded list).
   */
  pageTypes: PageTypeRef[];
};

export type DiscoveryResult = {
  /** Root of the entry URL — every non-PDP probe starts here. */
  homeUrl: string;
  /** page_code → reachability + url + evidence. */
  pages: DiscoveredPages;
  /** The found page_codes, ready to hand to `scoreRun({ availablePages })`. */
  availablePages: Set<string>;
  /** The identified storefront search engine (run context + Prompt-5 finding). */
  searchEngine: SearchEngineId;
};

/**
 * Injectable collaborators so the module is unit-testable without the network.
 * Defaults wire to the real static-HTML helpers + ASE.
 */
export type DiscoveryDeps = {
  /** Raw fetch (homepage HTML for login/search/static-engine scans). */
  fetchImpl: typeof fetch;
  /** Homepage link scraper (category candidate, hints, logo). */
  discoverSamples: (rootUrl: string) => Promise<DiscoveredSamples>;
  /** Site-wide HTTP probe (robots / sitemap / llms.txt). */
  probeSiteWide: (rootUrl: string) => Promise<SiteWideContext | null>;
  /** ASE site-signals (engine fingerprint + has_search_box). */
  scanSiteSignals: (input: {
    url: string;
    categoryUrl?: string | null;
  }) => Promise<SiteSignals | null>;
  /**
   * Search-engine fingerprint from a browser network capture, when a probe ran
   * (Prompt 5/6 supply it). `null` = no browser signal — the default for Prompt
   * 4, which never launches the probe itself.
   */
  browserEngineFingerprint: string | null;
};

/** True when the browser probe is enabled + fully configured (existing flags). */
export function browserProbeEnabled(): boolean {
  return (
    process.env.PROSPECTOS_BROWSER_PROBE_ENABLED === "1" &&
    !!process.env.BROWSERLESS_HOST &&
    !!process.env.BROWSERLESS_TOKEN
  );
}

function defaultDeps(): DiscoveryDeps {
  return {
    fetchImpl: fetch,
    discoverSamples,
    probeSiteWide: async (rootUrl) => {
      try {
        return await probeSiteWide(rootUrl);
      } catch {
        return null;
      }
    },
    scanSiteSignals: async (input) => {
      try {
        return await scanSiteSignals(input);
      } catch {
        // ASE unreachable / ASE_API_URL unset / non-2xx — degrade silently.
        return null;
      }
    },
    browserEngineFingerprint: null,
  };
}

/** Strip a URL to its scheme + host (the home / site-wide root). */
function rootOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

async function safeFetchText(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ ok: boolean; status: number | null; html: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    let html = "";
    try {
      html = await res.text();
    } catch {
      /* binary / unreadable */
    }
    return { ok: res.ok, status: res.status, html };
  } catch {
    return { ok: false, status: null, html: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The distinct page_types referenced by a loaded check set — the DB-as-truth
 * input to discovery. Deduped by `page_code`; the hint comes along for evidence.
 */
export function pageTypesFromChecks(checks: AtomicCheck[]): PageTypeRef[] {
  const seen = new Map<string, PageTypeRef>();
  for (const c of checks) {
    const code = c.pageType.code;
    if (!seen.has(code)) {
      seen.set(code, { code, discoveryHint: c.pageType.discoveryHint });
    }
  }
  return [...seen.values()];
}

// ── Homepage link heuristics (mirror sample-discovery's same-host approach) ──

function sameHostHrefs(html: string, base: string): string[] {
  const baseHost = (() => {
    try {
      return new URL(base).host;
    } catch {
      return "";
    }
  })();
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.host === baseHost) out.push(u.toString());
    } catch {
      /* skip malformed */
    }
  }
  return [...new Set(out)];
}

const LOGIN_PATH_PATTERNS = [
  /\/login\b/i,
  /\/log-in\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/account\b/i,
  /\/my-account\b/i,
  /\/customer\/account/i,
  /\/cuenta\b/i,
  /\/mi-cuenta\b/i,
  /\/iniciar-sesion\b/i,
  /\/acceso\b/i,
  /\/auth\b/i,
];

/**
 * LOGIN: discover a login/account link from the homepage. Anonymous audit — if
 * none is found we report `found:false` (→ engine scores auth.* `na`); we never
 * pause to ask a human, despite the DB hint mentioning it.
 */
function resolveLogin(html: string, homeUrl: string): DiscoveredPage {
  const hrefs = sameHostHrefs(html, homeUrl);
  const match = hrefs.find((u) => {
    try {
      return LOGIN_PATH_PATTERNS.some((p) => p.test(new URL(u).pathname));
    } catch {
      return false;
    }
  });
  if (match) {
    return { found: true, url: match, evidence: { via: "homepage_link" } };
  }
  return {
    found: false,
    evidence: { reason: "no_login_link", note: "anonymous_audit_no_prompt" },
  };
}

/** Per-platform native search URL shape, used only when ASE flags a search box. */
function nativeSearchGuess(
  homeUrl: string,
  platform: string | null,
): { url: string; param: string } | null {
  const p = (platform ?? "").toLowerCase();
  try {
    if (p.includes("shopify")) {
      return { url: new URL("/search", homeUrl).toString(), param: "q" };
    }
    if (p.includes("woo") || p.includes("wordpress")) {
      return { url: new URL("/", homeUrl).toString(), param: "s" };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * SEARCH_RESULTS: locate a results page by triggering a search from the home
 * page. Without the browser we infer the search endpoint: prefer a real search
 * `<form>` on the homepage (its action + query param); otherwise, if ASE flags
 * a search box, fall back to a platform-shaped guess. Discovery only resolves
 * the endpoint — Prompt 5 issues the actual query.
 */
function resolveSearchResults(
  html: string,
  homeUrl: string,
  siteSignals: SiteSignals | null,
): DiscoveredPage {
  // A search form: a <form> whose markup smells like search (role=search, or a
  // search/q/s input). Capture action + the query param name.
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1];
    const inner = m[2];
    const looksSearch =
      /role=["']search["']/i.test(attrs) ||
      /type=["']search["']/i.test(inner) ||
      /\/search/i.test(attrs) ||
      /name=["'](?:q|s|query|search)["']/i.test(inner);
    if (!looksSearch) continue;

    const actionMatch = attrs.match(/action=["']([^"']*)["']/i);
    let actionUrl = homeUrl;
    try {
      actionUrl = new URL(actionMatch?.[1] || homeUrl, homeUrl).toString();
    } catch {
      /* keep homeUrl */
    }
    const paramMatch =
      inner.match(/name=["'](q|s|query|search)["']/i) ?? null;
    const param = paramMatch?.[1] ?? "q";
    return {
      found: true,
      url: actionUrl,
      evidence: { via: "homepage_search_form", method: "form", param },
    };
  }

  // No form, but ASE saw a search box → infer a platform-shaped endpoint.
  if (siteSignals?.has_search_box) {
    const guess = nativeSearchGuess(homeUrl, siteSignals.platform_detected);
    if (guess) {
      return {
        found: true,
        url: guess.url,
        evidence: {
          via: "ase_has_search_box_platform_guess",
          platform: siteSignals.platform_detected,
          param: guess.param,
        },
      };
    }
    return {
      found: true,
      url: undefined,
      evidence: { via: "ase_has_search_box", note: "endpoint_unknown" },
    };
  }

  return { found: false, evidence: { reason: "no_search_affordance" } };
}

// ── Search-engine identification ─────────────────────────────────────────────

/**
 * Engine fingerprints — mirror of `ENGINE_NETWORK_PATTERNS` in
 * `browser-probe.ts` (kept local to keep Prompt 4 purely additive). Applied to
 * homepage HTML (script srcs / inline config) as a static fallback when neither
 * a browser network capture nor ASE supplies an engine.
 */
const ENGINE_HTML_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "algolia", pattern: /algolia\.net|algolianet\.com|algoliasearch|InstantSearch/i },
  { name: "meilisearch", pattern: /meilisearch|\/indexes\/[^/]+\/search/i },
  { name: "typesense", pattern: /typesense\.org|\/collections\/[^/]+\/documents\/search/i },
  { name: "klevu", pattern: /klevu\.com|js\.klevu/i },
  { name: "doofinder", pattern: /doofinder\.com|doofinder/i },
  { name: "searchanise", pattern: /searchanise\.io|searchanise/i },
  { name: "shopify_native", pattern: /\/search\/suggest\.json|\/predictive_search\.json/i },
  { name: "woocommerce_native", pattern: /[?&]s=|wp-content\/plugins/i },
];

/** Bucket a raw fingerprint / ASE name into the canonical engine set. */
function normalizeEngine(raw: string | null | undefined): SearchEngine {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (s.includes("algolia")) return "algolia";
  if (s.includes("meili")) return "meilisearch";
  if (s.includes("typesense")) return "typesense";
  if (s.includes("klevu") || s.includes("doofinder") || s.includes("searchanise")) {
    return "other";
  }
  if (s.includes("native") || s.includes("shopify") || s.includes("woo") || s.includes("wordpress")) {
    return "native";
  }
  return "unknown";
}

function fingerprintHtml(html: string): string | null {
  for (const { name, pattern } of ENGINE_HTML_PATTERNS) {
    if (pattern.test(html)) return name;
  }
  return null;
}

/**
 * Identify the storefront search engine, most-trustworthy source first:
 *   1. browser network fingerprint (ground-truth XHR endpoints) — high
 *   2. ASE static site-signals `engine_detected` — medium
 *   3. homepage HTML fingerprint — low
 *   4. nothing → unknown
 */
export function detectSearchEngine(args: {
  homepageHtml: string;
  siteSignals: SiteSignals | null;
  browserEngineFingerprint: string | null;
}): SearchEngineId {
  const { homepageHtml, siteSignals, browserEngineFingerprint } = args;

  if (browserEngineFingerprint) {
    return {
      engine: normalizeEngine(browserEngineFingerprint),
      raw: browserEngineFingerprint,
      source: "browser_network",
      confidence: "high",
    };
  }
  if (siteSignals?.engine_detected) {
    return {
      engine: normalizeEngine(siteSignals.engine_detected),
      raw: siteSignals.engine_detected,
      source: "ase_site_signals",
      confidence: "medium",
    };
  }
  const fromHtml = fingerprintHtml(homepageHtml);
  if (fromHtml) {
    return {
      engine: normalizeEngine(fromHtml),
      raw: fromHtml,
      source: "homepage_html",
      confidence: "low",
    };
  }
  return { engine: "unknown", raw: null, source: "none", confidence: "none" };
}

/**
 * Resolve every requested page_type from the entry PDP, plus the search engine.
 * Pure orchestration over injectable collaborators — no DB writes (persistence
 * is `persistDiscoveredPages`, wired in by Prompt 6).
 */
export async function discoverPages(
  input: DiscoverPagesInput,
  depsOverride: Partial<DiscoveryDeps> = {},
): Promise<DiscoveryResult> {
  const deps: DiscoveryDeps = { ...defaultDeps(), ...depsOverride };
  const homeUrl = rootOf(input.entryUrl);

  // Probe the shared inputs once, in parallel (mirrors the legacy runner).
  const [home, samples, siteWide, siteSignals] = await Promise.all([
    safeFetchText(deps.fetchImpl, homeUrl),
    deps.discoverSamples(homeUrl).catch(() => null),
    deps.probeSiteWide(homeUrl),
    deps.scanSiteSignals({ url: homeUrl, categoryUrl: null }),
  ]);

  const searchEngine = detectSearchEngine({
    homepageHtml: home.html,
    siteSignals,
    browserEngineFingerprint: deps.browserEngineFingerprint,
  });

  // A non-null HTTP status means the site responded (even 429 rate-limit or
  // 403 bot-protection counts — the server is there). Only treat as unreachable
  // when home.status is null (network failure / timeout / DNS miss). Previously
  // this required home.ok (2xx only), which caused all FETCH-based scorers to
  // return `na` when a site had bot-protection or rate-limited the discovery
  // fetch — even though the individual artifact fetches (sitemap.xml, etc.)
  // would have succeeded.
  const siteReachable =
    home.ok ||
    home.status !== null ||
    !!siteWide?.llmsTxt.present ||
    !!siteWide?.robotsTxt.present ||
    !!siteWide?.sitemap.present;

  const pages: DiscoveredPages = {};
  for (const pt of input.pageTypes) {
    pages[pt.code] = resolveOne(pt, {
      entryUrl: input.entryUrl,
      homeUrl,
      home,
      samples,
      siteWide,
      siteSignals,
      siteReachable,
    });
  }

  const availablePages = new Set(
    Object.entries(pages)
      .filter(([, p]) => p.found)
      .map(([code]) => code),
  );

  return { homeUrl, pages, availablePages, searchEngine };
}

type ResolveCtx = {
  entryUrl: string;
  homeUrl: string;
  home: { ok: boolean; status: number | null; html: string };
  samples: DiscoveredSamples | null;
  siteWide: SiteWideContext | null;
  siteSignals: SiteSignals | null;
  siteReachable: boolean;
};

/**
 * Dispatch one page_type to its strategy. We branch on the DB `page_code`
 * (the machine key); the `discovery_hint` is the DB-authored description and is
 * recorded in evidence. Unknown codes resolve to not-found rather than throwing.
 */
function resolveOne(pt: PageTypeRef, ctx: ResolveCtx): DiscoveredPage {
  const withHint = (p: DiscoveredPage): DiscoveredPage => ({
    ...p,
    evidence: { discovery_hint: pt.discoveryHint, ...(p.evidence ?? {}) },
  });

  switch (pt.code) {
    case "PDP":
      // PDP-first: the submitted URL is the product page, by definition.
      return withHint({
        found: true,
        url: ctx.entryUrl,
        evidence: { via: "submitted_url" },
      });

    case "HOME":
      return withHint({
        found: ctx.home.ok,
        url: ctx.homeUrl,
        evidence: { via: "root_of_pdp", status: ctx.home.status },
      });

    case "SITE_WIDE":
      return withHint({
        found: ctx.siteReachable,
        url: ctx.homeUrl,
        evidence: {
          via: "root_domain",
          robots_present: ctx.siteWide?.robotsTxt.present ?? null,
          sitemap_present: ctx.siteWide?.sitemap.present ?? null,
          llms_present: ctx.siteWide?.llmsTxt.present ?? null,
        },
      });

    case "CATEGORY": {
      const url = ctx.samples?.categoryUrl ?? null;
      return withHint({
        found: !!url,
        url: url ?? undefined,
        evidence: {
          via: "homepage_category_link",
          reason: ctx.samples?.categoryReason ?? "homepage_unavailable",
        },
      });
    }

    case "SEARCH_RESULTS":
      return withHint(
        resolveSearchResults(ctx.home.html, ctx.homeUrl, ctx.siteSignals),
      );

    case "LOGIN":
      return withHint(resolveLogin(ctx.home.html, ctx.homeUrl));

    case "CART":
    case "CHECKOUT":
      // Out of the anonymous_landing_audit profile — never probed anonymously.
      return withHint({
        found: false,
        evidence: { reason: "not_in_anonymous_profile" },
      });

    default:
      return withHint({
        found: false,
        evidence: { reason: "unknown_page_type" },
      });
  }
}

// ── Persistence (run_sample + prospect_page/page_scan, v4 shape) ──────────────

/** v5 page_code → legacy `sample_type` enum value, when one exists. */
const PAGE_CODE_TO_SAMPLE_TYPE: Record<string, string> = {
  PDP: "pdp",
  CATEGORY: "category",
  HOME: "homepage",
  SEARCH_RESULTS: "search_query",
};

type MinimalSupabase = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type PersistDiscoveryInput = {
  runId: string;
  prospectId: number;
  instanceId: number | null;
  startedAt?: string;
};

/**
 * Persist what discovery looked at, so the report can show it — using the
 * existing v4 tables. Two layers, mirroring the legacy runner:
 *   - `run_sample`: one append-only row per found page that maps to the
 *     `sample_type` enum (pdp / category / homepage / search_query).
 *   - `prospect_page` + `page_scan`: one row per distinct found URL (deduped —
 *     HOME and SITE_WIDE share the root), with the discovery evidence + engine
 *     id captured in `page_scan.signals`.
 *
 * Best-effort and additive: failures are swallowed (this is a report nicety,
 * not the scoring path). Wired in by Prompt 6.
 */
export async function persistDiscoveredPages(
  supabase: MinimalSupabase,
  { runId, prospectId, instanceId, startedAt }: PersistDiscoveryInput,
  result: DiscoveryResult,
): Promise<void> {
  const found = Object.entries(result.pages).filter(([, p]) => p.found);

  // 1. run_sample (enum-mapped subset).
  const samples = found
    .filter(([code]) => code in PAGE_CODE_TO_SAMPLE_TYPE)
    .map(([code, page]) => ({
      run_id: runId,
      sample_type: PAGE_CODE_TO_SAMPLE_TYPE[code],
      url_or_query: page.url ?? result.homeUrl,
      selection_reason: `v5_discovery:${code}`,
    }));
  if (samples.length > 0) {
    try {
      await supabase.from("run_sample").insert(samples);
    } catch {
      /* report nicety only */
    }
  }

  // 2. prospect_page + page_scan, deduped by URL (HOME/SITE_WIDE share root).
  const byUrl = new Map<string, { codes: string[]; evidence: unknown[] }>();
  for (const [code, page] of found) {
    const url = page.url ?? result.homeUrl;
    const entry = byUrl.get(url) ?? { codes: [], evidence: [] };
    entry.codes.push(code);
    entry.evidence.push({ code, evidence: page.evidence ?? null });
    byUrl.set(url, entry);
  }

  for (const [url, entry] of byUrl) {
    try {
      let pageId: number | null = null;
      const { data: existing } = await supabase
        .from("prospect_page")
        .select("prospect_page_id")
        .eq("prospect_id", prospectId)
        .eq("url", url)
        .maybeSingle();
      if (existing) {
        pageId = existing.prospect_page_id as number;
      } else {
        const { data: inserted } = await supabase
          .from("prospect_page")
          .insert({
            prospect_id: prospectId,
            instance_id: instanceId,
            url,
            // Representative v5 code (lowercased); all codes live in signals.
            page_type: entry.codes[0].toLowerCase(),
            discovered_via: "auto",
          })
          .select("prospect_page_id")
          .single();
        pageId = (inserted?.prospect_page_id as number) ?? null;
      }
      if (pageId === null) continue;

      await supabase.from("page_scan").insert({
        prospect_page_id: pageId,
        run_id: runId,
        instance_id: instanceId,
        status: "discovered",
        started_at: startedAt ?? null,
        signals: {
          v5_page_codes: entry.codes,
          discovery: entry.evidence,
          search_engine: result.searchEngine,
        },
      });
    } catch {
      /* report nicety only */
    }
  }
}
