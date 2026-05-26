/**
 * Browser-based probes for the Prospectos diagnostic.
 *
 * Static HTML can answer "what does the PDP look like?" but it can't
 * answer "does the search box have typo tolerance?" — for that we need
 * a real browser that types into the search input, follows the
 * navigation, and inspects the results page. This module is that.
 *
 * Gated on PROSPECTOS_BROWSER_PROBE_ENABLED=1. When disabled or if
 * Playwright fails to launch (no Chromium binaries available, e.g. on
 * Vercel serverless without setup), the probe returns null and the
 * scorers degrade those checks to result_status='na' with a clear
 * reason.
 *
 * Deployment notes:
 *   - Local dev: `npx playwright install chromium` after `npm install`.
 *   - Vercel: not supported on serverless functions today. Deploy this
 *     workload to a Railway / Fly / dedicated host, or wrap with
 *     @sparticuz/chromium + playwright-core.
 *   - Managed alt: Browserless.io / Browserbase — use the CDP URL and
 *     swap chromium.launch() for chromium.connect(wsEndpoint).
 *
 * Time budget: ~60s per run. Each query test ~5s.
 */

import type { Browser, BrowserContext, Page, Request } from "playwright";

const PROBE_ENABLED = process.env.PROSPECTOS_BROWSER_PROBE_ENABLED === "1";
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
};

export type EmptyStateTestResult = {
  query: string;
  graceful: boolean;
  has_fallback_content: boolean;
};

export type BrandTestResult = {
  brand: string;
  results_returned: boolean;
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
};

export type RunBrowserProbeInput = {
  rootUrl: string;
  synonymPairs: { term_a: string; term_b: string; locale: string }[];
  emptyStateQueries: string[];
};

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
  const notes: string[] = [];
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (e) {
    console.warn("[browser-probe] chromium launch failed:", e);
    notes.push(`browser_launch_failed:${String(e).slice(0, 80)}`);
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
      };
    }

    // 3. Typo tolerance test — use up to 2 discovered product names.
    const typoResults: TypoTestResult[] = [];
    for (const name of productNames.slice(0, 2)) {
      const mutated = mutateOneChar(name);
      const res = await runSearchQuery(page, context, input.rootUrl, mutated);
      typoResults.push({
        source_query: name,
        mutated_query: mutated,
        results_returned: res.resultsPresent,
        result_count_estimate: res.estimate,
      });
    }

    // 4. Synonym tests — up to MAX_QUERIES/2 pairs.
    const synonymResults: SynonymTestResult[] = [];
    for (const pair of input.synonymPairs.slice(0, Math.floor(MAX_QUERIES / 2))) {
      const a = await runSearchQuery(page, context, input.rootUrl, pair.term_a);
      const b = await runSearchQuery(page, context, input.rootUrl, pair.term_b);
      synonymResults.push({
        term_a: pair.term_a,
        term_b: pair.term_b,
        a_returned: a.resultsPresent,
        b_returned: b.resultsPresent,
        both_returned: a.resultsPresent && b.resultsPresent,
      });
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
    }

    // 6. Brand relevance — first discovered brand.
    const brandResults: BrandTestResult[] = [];
    for (const brand of brands.slice(0, 1)) {
      const res = await runSearchQuery(page, context, input.rootUrl, brand);
      brandResults.push({
        brand,
        results_returned: res.resultsPresent,
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
    };
  } finally {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    try {
      await browser.close();
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
};

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
      return { resultsPresent: false, estimate: null, hasFallbackContent: false, hardError: true };
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

    return await page.evaluate(() => {
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
      ];
      let estimate = 0;
      for (const sel of resultSelectors) {
        const n = document.querySelectorAll(sel).length;
        if (n > estimate) estimate = n;
      }

      const hasFallbackContent =
        document.body.innerText.length > 600 && !hasNoResultsCopy;

      return {
        resultsPresent: estimate > 0 && !hasNoResultsCopy,
        estimate: estimate > 0 ? estimate : null,
        hasFallbackContent,
        hardError: false,
      };
    });
  } catch (e) {
    return {
      resultsPresent: false,
      estimate: null,
      hasFallbackContent: false,
      hardError: true,
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
