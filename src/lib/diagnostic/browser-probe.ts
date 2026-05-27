/**
 * Browser-based probes for the Prospectos diagnostic.
 *
 * Static HTML can answer "what does the PDP look like?" but it can't
 * answer "does the search box have typo tolerance?" — for that we need
 * a real browser that types into the search input, follows the
 * navigation, and inspects the results page. This module is that.
 *
 * Gated on PROSPECTOS_BROWSER_PROBE_ENABLED=1. When disabled or if
 * Playwright fails to launch / connect, the probe returns null and the
 * scorers degrade those checks to result_status='na' with a clear
 * reason.
 *
 * Browser source:
 *   - Production: BROWSERLESS_HOST + BROWSERLESS_TOKEN both set →
 *     connect to a managed Chromium via CDP at
 *     wss://<HOST>?token=<TOKEN>. The host (region or enterprise
 *     private fleet) is fully configurable; nothing is hardcoded.
 *     No binaries shipped in the deploy bundle, no cold-start launch
 *     cost. Recommended for serverless (Vercel).
 *   - Local dev: BROWSERLESS_HOST / TOKEN unset → launch a local
 *     Chromium via `playwright install chromium`. Useful for
 *     debugging the probe itself; not viable on Vercel.
 *
 * Time budget: ~60s per run. Each query test ~5s. Vercel Pro plan
 * gives 60s function timeout — exactly the budget we plan for.
 */

import type { Browser, BrowserContext, Page, Request } from "playwright";

const PROBE_ENABLED = process.env.PROSPECTOS_BROWSER_PROBE_ENABLED === "1";
const BROWSERLESS_HOST = process.env.BROWSERLESS_HOST; // e.g. "production-sfo.browserless.io"
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

/**
 * Build the wss:// CDP endpoint from configured host + token. Returns
 * null when either piece is missing — the caller falls back to a local
 * Chromium launch (dev) or surfaces the misconfig (prod). The protocol
 * is fixed at wss:// because that's what Playwright's connectOverCDP
 * speaks; the host (region or enterprise fleet) is fully configurable.
 */
function buildBrowserlessWsUrl(): string | null {
  if (!BROWSERLESS_HOST || !BROWSERLESS_TOKEN) return null;
  const host = BROWSERLESS_HOST.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return `wss://${host}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;
}
const MAX_QUERIES = 6; // safety cap so a wide vocabulary doesn't blow the budget
const PER_QUERY_TIMEOUT_MS = 12_000;
const NAV_TIMEOUT_MS = 20_000;

export type TypoTestResult = {
  source_query: string;
  mutated_query: string;
  results_returned: boolean;
  result_count_estimate: number | null;
};

export type SynonymTestResult = {
  term_a: string;
  term_b: string;
  a_returned: boolean;
  b_returned: boolean;
  both_returned: boolean;
  a_result_names: string[];
  b_result_names: string[];
  overlap_count: number;
};

export type EmptyStateTestResult = {
  query: string;
  graceful: boolean;
  has_fallback_content: boolean;
};

export type BrandTestResult = {
  brand: string;
  results_returned: boolean;
  brand_in_top_results: boolean | null;
  top_result_names: string[];
};

/**
 * A screenshot captured during the probe, tagged with the check it
 * serves as evidence for. Uploaded by the runner via uploadProbeScreenshots()
 * and the resulting public URL is patched onto finding.evidence.screenshot_url.
 *
 * At most one screenshot per check_code today (the "most representative"
 * moment). Future: capture multiple and store as an array.
 */
export type ProbeScreenshot = {
  check_code: string;
  buffer: Buffer;
};

/**
 * Per-variant result from probing a user-defined search_test_entry.
 * Persisted to the search_test_result table by the runner, joined to
 * a page_scan_id so the report can render results grouped by entry.
 */
export type EntryVariantResult = {
  variant_id: number;
  variant_type: "canonical" | "typo" | "synonym" | "plural" | "partial" | string;
  query_text: string;
  results_returned: boolean;
  result_count_estimate: number | null;
  top_result_names: string[];
  screenshot: Buffer | null;
  latency_ms: number | null;
};

export type EntryProbeResult = {
  entry_id: number;
  intent_label: string;
  variant_results: EntryVariantResult[];
};

/** Shape the runner passes in for the new entry-based probe. */
export type TestEntryInput = {
  entry_id: number;
  intent_label: string;
  variants: Array<{
    variant_id: number;
    variant_type: string;
    query_text: string;
  }>;
};

export type BrowserProbeResult = {
  product_names_discovered: string[];
  brands_discovered: string[];
  search_box_found: boolean;
  search_action_kind: "form_submit" | "xhr" | null;
  typo_tests: TypoTestResult[];
  synonym_tests: SynonymTestResult[];
  empty_state_test: EmptyStateTestResult | null;
  brand_tests: BrandTestResult[];
  engine_network_fingerprint: string | null;
  notes: string[];
  screenshots: ProbeScreenshot[];
  /** Per-entry, per-variant results from the new search-test-entries path. */
  entry_results: EntryProbeResult[];
};

export type RunBrowserProbeInput = {
  rootUrl: string;
  synonymPairs: { term_a: string; term_b: string; locale: string }[];
  emptyStateQueries: string[];
  /**
   * User-defined test entries (search_test_entry rows for this prospect
   * + inherited vertical templates). Each entry's variants are typed
   * into the search box and results are captured per variant. Capped
   * by MAX_ENTRY_VARIANTS to keep the probe under its 60s budget.
   */
  testEntries?: TestEntryInput[];
};

const MAX_ENTRY_VARIANTS = 12;

export async function runBrowserProbe(
  input: RunBrowserProbeInput,
): Promise<BrowserProbeResult | null> {
  if (!PROBE_ENABLED) return null;

  let playwright;
  try {
    playwright = await import("playwright");
  } catch (e) {
    console.warn("[browser-probe] playwright not loadable:", e);
    return null;
  }

  let browser: Browser | null = null;
  // We "own" the browser only when we launched it locally — in that case
  // we must browser.close() at the end. When connected via CDP to a
  // shared Browserless instance, we only close our context; the remote
  // browser keeps serving other connections.
  let weLaunchedIt = false;
  const notes: string[] = [];
  const screenshots: ProbeScreenshot[] = [];
  try {
    const wsUrl = buildBrowserlessWsUrl();
    if (wsUrl) {
      browser = await playwright.chromium.connectOverCDP(wsUrl);
      notes.push("browser_source:browserless");
    } else {
      browser = await playwright.chromium.launch({ headless: true });
      weLaunchedIt = true;
      notes.push("browser_source:local_launch");
    }
  } catch (e) {
    console.warn("[browser-probe] could not obtain browser:", e);
    notes.push(`browser_obtain_failed:${String(e).slice(0, 120)}`);
    return {
      product_names_discovered: [],
      brands_discovered: [],
      search_box_found: false,
      search_action_kind: null,
      typo_tests: [],
      synonym_tests: [],
      empty_state_test: null,
      brand_tests: [],
      engine_network_fingerprint: null,
      notes,
      screenshots,
      entry_results: [],
    };
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PER_QUERY_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    const networkUrls: string[] = [];
    page.on("request", (req: Request) => {
      networkUrls.push(req.url());
    });

    await safeGoto(page, input.rootUrl);

    // 1. Discover product names + brands from the homepage.
    const { productNames, brands } = await discoverFromHomepage(page);
    if (productNames.length === 0) {
      notes.push("no_product_names_discovered_from_homepage");
    }

    // 2. Locate the search input.
    const searchInput = await findSearchInput(page);
    if (!searchInput) {
      return {
        product_names_discovered: productNames,
        brands_discovered: brands,
        search_box_found: false,
        search_action_kind: null,
        typo_tests: [],
        synonym_tests: [],
        empty_state_test: null,
        brand_tests: [],
        engine_network_fingerprint: detectEngineFromNetwork(networkUrls),
        notes,
        screenshots,
        entry_results: [],
      };
    }

    // 3. Typo tolerance test — use up to 2 discovered product names.
    // Only the first typo's screenshot is captured as evidence (one
    // representative moment per finding; multi-screenshot evidence
    // is a future iteration).
    const typoResults: TypoTestResult[] = [];
    for (const [idx, name] of productNames.slice(0, 2).entries()) {
      const mutated = mutateOneChar(name);
      const res = await runSearchQuery(page, context, input.rootUrl, mutated);
      typoResults.push({
        source_query: name,
        mutated_query: mutated,
        results_returned: res.resultsPresent,
        result_count_estimate: res.estimate,
      });
      if (idx === 0 && res.screenshot) {
        screenshots.push({
          check_code: "on_site_nav.typo_tolerance",
          buffer: res.screenshot,
        });
      }
    }

    // 4. Synonym tests — up to MAX_QUERIES/2 pairs. We also capture
    // top result names so the scorer can measure overlap (true synonym
    // coverage means similar products surface for both terms). Only
    // the first pair's term_a screenshot is captured as evidence.
    const synonymResults: SynonymTestResult[] = [];
    for (const [idx, pair] of input.synonymPairs
      .slice(0, Math.floor(MAX_QUERIES / 2))
      .entries()) {
      const a = await runSearchQuery(page, context, input.rootUrl, pair.term_a);
      const b = await runSearchQuery(page, context, input.rootUrl, pair.term_b);
      const aSet = new Set(a.topResultNames.map((s) => s.toLowerCase()));
      const overlap = b.topResultNames.filter((n) => aSet.has(n.toLowerCase())).length;
      synonymResults.push({
        term_a: pair.term_a,
        term_b: pair.term_b,
        a_returned: a.resultsPresent,
        b_returned: b.resultsPresent,
        both_returned: a.resultsPresent && b.resultsPresent,
        a_result_names: a.topResultNames.slice(0, 5),
        b_result_names: b.topResultNames.slice(0, 5),
        overlap_count: overlap,
      });
      if (idx === 0 && a.screenshot) {
        screenshots.push({
          check_code: "on_site_nav.synonyms",
          buffer: a.screenshot,
        });
      }
    }

    // 5. Empty-state test — first available gibberish query.
    let emptyState: EmptyStateTestResult | null = null;
    const gibberish = input.emptyStateQueries[0];
    if (gibberish) {
      const res = await runSearchQuery(page, context, input.rootUrl, gibberish);
      emptyState = {
        query: gibberish,
        graceful: !res.resultsPresent && !res.hardError,
        has_fallback_content: res.hasFallbackContent,
      };
      if (res.screenshot) {
        screenshots.push({
          check_code: "on_site_nav.empty_state",
          buffer: res.screenshot,
        });
      }
    }

    // 6. Brand relevance — first discovered brand. We check whether the
    // brand name actually appears in the top result names (i.e. the site
    // ranked that brand first, not just "any results came back").
    const brandResults: BrandTestResult[] = [];
    for (const [idx, brand] of brands.slice(0, 1).entries()) {
      const res = await runSearchQuery(page, context, input.rootUrl, brand);
      const brandLower = brand.toLowerCase();
      const topNames = res.topResultNames.slice(0, 3);
      const brandInTop =
        topNames.length === 0
          ? null
          : topNames.some((n) => n.toLowerCase().includes(brandLower));
      brandResults.push({
        brand,
        results_returned: res.resultsPresent,
        brand_in_top_results: brandInTop,
        top_result_names: topNames,
      });
      if (idx === 0 && res.screenshot) {
        screenshots.push({
          check_code: "on_site_nav.relevance_brand",
          buffer: res.screenshot,
        });
      }
    }

    // 7. NEW: iterate user-defined test entries → variants. Each variant
    // is typed into the search box; we capture result count + top names
    // + a screenshot. Capped at MAX_ENTRY_VARIANTS total variants across
    // all entries to keep the probe inside the 60s budget.
    const entryResults: EntryProbeResult[] = [];
    let variantBudget = MAX_ENTRY_VARIANTS;
    for (const entry of input.testEntries ?? []) {
      if (variantBudget <= 0) {
        notes.push(`entry_variant_budget_exceeded:skipped_entry_${entry.entry_id}`);
        break;
      }
      const variantResults: EntryVariantResult[] = [];
      // Run canonical first so synonym overlap analysis (future) has
      // it as the reference point.
      const ordered = [...entry.variants].sort((a, b) => {
        if (a.variant_type === "canonical") return -1;
        if (b.variant_type === "canonical") return 1;
        return 0;
      });
      for (const variant of ordered) {
        if (variantBudget <= 0) break;
        variantBudget -= 1;
        const start = Date.now();
        const res = await runSearchQuery(page, context, input.rootUrl, variant.query_text);
        const latency = Date.now() - start;
        variantResults.push({
          variant_id: variant.variant_id,
          variant_type: variant.variant_type,
          query_text: variant.query_text,
          results_returned: res.resultsPresent,
          result_count_estimate: res.estimate,
          top_result_names: res.topResultNames.slice(0, 5),
          screenshot: res.screenshot,
          latency_ms: latency,
        });
      }
      entryResults.push({
        entry_id: entry.entry_id,
        intent_label: entry.intent_label,
        variant_results: variantResults,
      });
    }

    return {
      product_names_discovered: productNames,
      brands_discovered: brands,
      search_box_found: true,
      search_action_kind: detectActionKind(networkUrls),
      typo_tests: typoResults,
      synonym_tests: synonymResults,
      empty_state_test: emptyState,
      brand_tests: brandResults,
      engine_network_fingerprint: detectEngineFromNetwork(networkUrls),
      notes,
      screenshots,
      entry_results: entryResults,
    };
  } catch (e) {
    notes.push(`browser_probe_error:${String(e).slice(0, 160)}`);
    return {
      product_names_discovered: [],
      brands_discovered: [],
      search_box_found: false,
      search_action_kind: null,
      typo_tests: [],
      synonym_tests: [],
      empty_state_test: null,
      brand_tests: [],
      engine_network_fingerprint: null,
      notes,
      screenshots,
      entry_results: [],
    };
  } finally {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    // Only close the browser when we launched it ourselves. For
    // Browserless we just disconnect — calling close() would also work
    // but the disconnect is cleaner (doesn't ask the remote browser
    // to fully shut down its process for our session).
    try {
      if (weLaunchedIt) {
        await browser.close();
      } else {
        await browser.close(); // Playwright's CDP close ≅ disconnect
      }
    } catch {
      /* ignore */
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function safeGoto(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function discoverFromHomepage(
  page: Page,
): Promise<{ productNames: string[]; brands: string[] }> {
  // Prefer Product JSON-LD blobs (most accurate). Fall back to heuristics
  // on product-card text.
  return await page.evaluate(() => {
    const names = new Set<string>();
    const brands = new Set<string>();

    const flatten = (b: unknown): unknown[] => {
      if (Array.isArray(b)) return b.flatMap((x) => flatten(x));
      if (b && typeof b === "object" && "@graph" in b) {
        return flatten((b as { "@graph": unknown }) ["@graph"]);
      }
      return [b];
    };

    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((s) => {
        try {
          const data = JSON.parse(s.textContent ?? "");
          for (const node of flatten(data)) {
            if (!node || typeof node !== "object") continue;
            const n = node as Record<string, unknown>;
            const type = String(n["@type"] ?? "");
            if (type.includes("Product") && typeof n.name === "string") {
              names.add(n.name);
              const brand = n.brand;
              if (brand && typeof brand === "object" && "name" in brand) {
                const bn = (brand as { name: unknown }).name;
                if (typeof bn === "string") brands.add(bn);
              } else if (typeof brand === "string") {
                brands.add(brand);
              }
            }
            if (
              (type.includes("ItemList") || type.includes("List")) &&
              Array.isArray(n.itemListElement)
            ) {
              for (const item of n.itemListElement) {
                if (item && typeof item === "object") {
                  const i = item as Record<string, unknown>;
                  if (typeof i.name === "string") names.add(i.name);
                  const inner = i.item;
                  if (inner && typeof inner === "object") {
                    const innerName = (inner as { name?: unknown }).name;
                    if (typeof innerName === "string") names.add(innerName);
                  }
                }
              }
            }
          }
        } catch {
          /* ignore */
        }
      });

    // Heuristic fallback: product card titles
    if (names.size === 0) {
      const candidates = document.querySelectorAll(
        ".product-title, .woocommerce-loop-product__title, .product-card__title, [class*='product-name'], li.product h2, .product h3",
      );
      let i = 0;
      candidates.forEach((el) => {
        if (i >= 6) return;
        const text = el.textContent?.trim();
        if (text && text.length > 2) {
          names.add(text);
          i += 1;
        }
      });
    }

    return {
      productNames: Array.from(names).slice(0, 6),
      brands: Array.from(brands).slice(0, 4),
    };
  });
}

async function findSearchInput(page: Page) {
  const selectors = [
    'input[type="search"]',
    'form[role="search"] input',
    'input[name="s"]',
    'input[name="q"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="buscar" i]',
    "[data-search-input]",
    "[aria-label*='search' i]",
    "[aria-label*='buscar' i]",
  ];
  for (const sel of selectors) {
    const handle = await page.$(sel);
    if (handle) return handle;
  }
  return null;
}

type SearchOutcome = {
  resultsPresent: boolean;
  estimate: number | null;
  hasFallbackContent: boolean;
  hardError: boolean;
  topResultNames: string[];
  /**
   * PNG snapshot of the results page at the moment of capture. Used
   * as evidence on the diagnostic report ("here's literally what we
   * saw"). Null when the page couldn't be reached at all.
   */
  screenshot: Buffer | null;
};

async function captureScreenshot(page: Page): Promise<Buffer | null> {
  try {
    // Above-the-fold only (fullPage:false). Bigger captures hurt
    // upload size + report render perf, and the empty-state /
    // top-results signal lives at the top of the page anyway.
    return await page.screenshot({ fullPage: false, type: "png" });
  } catch {
    return null;
  }
}

async function runSearchQuery(
  page: Page,
  context: BrowserContext,
  rootUrl: string,
  query: string,
): Promise<SearchOutcome> {
  try {
    // Always re-navigate to root to get a clean state.
    await safeGoto(page, rootUrl);
    const input = await findSearchInput(page);
    if (!input) {
      return {
        resultsPresent: false,
        estimate: null,
        hasFallbackContent: false,
        hardError: true,
        topResultNames: [],
        screenshot: null,
      };
    }
    await input.fill("");
    await input.type(query, { delay: 20 });
    await Promise.race([
      page.keyboard.press("Enter"),
      new Promise((r) => setTimeout(r, 200)),
    ]);
    // Wait briefly for navigation or XHR results to settle.
    await page
      .waitForLoadState("networkidle", { timeout: PER_QUERY_TIMEOUT_MS })
      .catch(() => {
        /* ignore */
      });

    // Capture the screenshot now — after results have settled and
    // before we read the DOM. The DOM read itself doesn't disturb the
    // page, but doing screenshot first means timing-sensitive sites
    // (e.g. lazy-loaded result thumbnails) still look right.
    const screenshot = await captureScreenshot(page);

    const domResult = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const noResultsPhrases = [
        "no results",
        "no resultados",
        "sin resultados",
        "0 results",
        "no se encontraron",
        "did not match",
        "nothing found",
      ];
      const hasNoResultsCopy = noResultsPhrases.some((p) => bodyText.includes(p));

      const resultSelectors = [
        "ul.products li.product",
        ".products .product",
        ".product-grid .product",
        "[data-search-result]",
        ".search-result",
        ".search-results .item",
        ".instantsearch-hit",
        ".algolia-autocomplete .product",
        ".collection-grid .product-card",
        ".product-list .product-item",
      ];
      let resultEls: Element[] = [];
      let estimate = 0;
      for (const sel of resultSelectors) {
        const els = Array.from(document.querySelectorAll(sel));
        if (els.length > estimate) {
          estimate = els.length;
          resultEls = els;
        }
      }

      // Extract names of the top result cards — title selectors that
      // work across WC / Shopify / generic.
      const nameSelectors = [
        ".woocommerce-loop-product__title",
        ".product-title",
        ".product-name",
        ".product-card__title",
        "h2.product__title",
        "h3.product-card__heading",
        "[class*='product-title']",
        "h2",
        "h3",
      ];
      const names: string[] = [];
      for (const el of resultEls.slice(0, 10)) {
        for (const sel of nameSelectors) {
          const nameEl = el.querySelector(sel);
          const text = nameEl?.textContent?.trim();
          if (text && text.length > 2 && text.length < 200) {
            names.push(text);
            break;
          }
        }
      }

      const hasFallbackContent =
        document.body.innerText.length > 600 && !hasNoResultsCopy;

      return {
        resultsPresent: estimate > 0 && !hasNoResultsCopy,
        estimate: estimate > 0 ? estimate : null,
        hasFallbackContent,
        hardError: false,
        topResultNames: names,
      };
    });

    return { ...domResult, screenshot };
  } catch (e) {
    return {
      resultsPresent: false,
      estimate: null,
      hasFallbackContent: false,
      hardError: true,
      topResultNames: [],
      screenshot: null,
    };
  }
}

function mutateOneChar(s: string): string {
  // Strategy: swap two adjacent chars in the middle of a word.
  const words = s.split(/\s+/).filter((w) => w.length >= 4);
  if (words.length === 0) {
    // Single-word fallback: append a random char
    return s + "z";
  }
  const target = words.reduce((a, b) => (a.length >= b.length ? a : b));
  const mid = Math.floor(target.length / 2);
  const mutated =
    target.slice(0, mid - 1) +
    target[mid] +
    target[mid - 1] +
    target.slice(mid + 1);
  return s.replace(target, mutated);
}

const ENGINE_NETWORK_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "algolia", pattern: /algolia\.net|algolianet\.com/i },
  { name: "meilisearch", pattern: /meilisearch|\/indexes\/[^/]+\/search/i },
  { name: "typesense", pattern: /typesense\.org|\/collections\/[^/]+\/documents\/search/i },
  { name: "klevu", pattern: /klevu\.com/i },
  { name: "doofinder", pattern: /doofinder\.com/i },
  { name: "searchanise", pattern: /searchanise\.io/i },
  { name: "shopify_native", pattern: /\/search\/suggest\.json|\/predictive_search\.json/i },
  { name: "woocommerce_native", pattern: /\?s=/i },
];

function detectEngineFromNetwork(urls: string[]): string | null {
  for (const { name, pattern } of ENGINE_NETWORK_PATTERNS) {
    if (urls.some((u) => pattern.test(u))) return name;
  }
  return null;
}

function detectActionKind(urls: string[]): "form_submit" | "xhr" | null {
  const hasXhr = urls.some((u) =>
    /\b(json|api|search\?|\/indexes\/|\/collections\/)/i.test(u),
  );
  if (hasXhr) return "xhr";
  const hasS = urls.some((u) => /\?s=/.test(u));
  return hasS ? "form_submit" : null;
}
