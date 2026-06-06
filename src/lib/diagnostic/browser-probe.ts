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
  /**
   * 0-100 confidence in the results_returned verdict.
   *   100 = explicit "no results" copy was matched
   *   95  = result names contain query tokens (relevant hits)
   *   70  = cards present but couldn't verify relevance / fallback content suspected
   *   60  = no signals either way (custom search engine with no visible cards)
   * Below ~80 → flag for manual review.
   */
  confidence: number;
  /** Human-readable explanation of how the verdict was reached. */
  verdict_reason: string;
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

    // 2. Locate the search input. Falls back to clicking a search
    // trigger (icon button / "Search" link) when the input isn't
    // directly visible — a UX issue we still want to evaluate around.
    const located = await locateOrOpenSearchInput(page, input.rootUrl);
    if (located.discovery !== "direct") {
      notes.push(`search_input_discovery:${located.discovery}`);
      notes.push(`search_input_note:${located.note}`);
    }
    if (!located.handle) {
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
    // For subsequent variant tests we re-navigate to rootUrl and
    // re-locate, so the handle isn't reused here.

    // 3. Typo tolerance test — use up to 2 discovered product names.
    // Only the first typo's screenshot is captured as evidence (one
    // representative moment per finding; multi-screenshot evidence
    // is a future iteration).
    // Limit to 1 product name to keep total queries within the 60s budget.
    // Each re-navigation (load + popup dismiss + trigger click) takes ~20s.
    const typoResults: TypoTestResult[] = [];
    for (const [idx, name] of productNames.slice(0, 1).entries()) {
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
        const res = await runSearchQuery(
          page,
          context,
          input.rootUrl,
          variant.query_text,
          variant.variant_type,
        );
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
          confidence: res.confidence,
          verdict_reason: res.verdictReason,
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
  // Give JS-heavy pages (Elementor, React storefronts) a moment to finish
  // rendering interactive elements like search toggles. networkidle can be
  // too slow on ad-heavy sites so we use a short fixed wait instead.
  await page.waitForTimeout(1200).catch(() => {});
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

/**
 * Result of trying to land on a usable search input.
 *
 *   discovery:
 *     "direct"         — an input matched on the first try (best case)
 *     "trigger_revealed" — we had to click a search-icon trigger
 *                          that revealed an input (modal/drawer)
 *     "trigger_navigated" — the trigger took us to a dedicated
 *                          /search-style page where we then found the
 *                          input
 *     "missing"        — nothing usable found
 *
 * `note` is a one-line human description for evidence.
 */
type SearchInputResult = {
  handle: import("playwright").ElementHandle | null;
  discovery: "direct" | "trigger_revealed" | "trigger_navigated" | "missing";
  note: string;
};

const INPUT_SELECTORS = [
  'input[type="search"]',
  'form[role="search"] input',
  'input[name="s"]',
  'input[name="q"]',
  'input[name="keyword"]',
  'input[name="query"]',
  'input[placeholder*="search" i]',
  'input[placeholder*="buscar" i]',
  "[data-search-input]",
  "[aria-label*='search' i][role='searchbox']",
  "[aria-label*='buscar' i][role='searchbox']",
];

async function findInputBySelectors(
  page: Page,
): Promise<import("playwright").ElementHandle | null> {
  for (const sel of INPUT_SELECTORS) {
    // Use $$ to check ALL matching elements — not just the first.
    // A selector can match both a hidden mobile-menu input and a visible
    // header input; page.$() would stop at the first (hidden) one.
    const handles = await page.$$(sel);
    for (const handle of handles) {
      const visible = await handle.isVisible().catch(() => false);
      if (visible) return handle;
    }
  }
  return null;
}

/**
 * Dismiss any overlay (popup, cookie banner, welcome modal) that might be
 * blocking interaction with the page. Acts like a human would:
 *
 *   1. Press Escape — closes most modal implementations.
 *   2. Spatially find the close button: look for any large overlay element
 *      (covering >30% of the viewport), then within it find the interactive
 *      element closest to its top-right corner that looks like a dismiss
 *      button (text ×/X/Close/Dismiss, aria-label, or close-like class).
 *   3. Click it; repeat up to `maxPasses` times for stacked popups.
 *
 * This is intentionally site-agnostic — no hardcoded class names or IDs.
 */
async function dismissOverlays(page: Page, maxPasses = 3): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400).catch(() => {});

  for (let pass = 0; pass < maxPasses; pass++) {
    // Run entirely in the browser context — finds the spatially closest
    // close-button in the top-right corner of any large overlay.
    const clicked = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Candidate overlay: any element that covers a large chunk of the
      // viewport and is actually visible on screen.
      const overlays = Array.from(document.querySelectorAll("*")).filter((el) => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          r.width > vw * 0.3 &&
          r.height > vh * 0.3 &&
          r.top < vh && r.bottom > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          parseFloat(style.opacity) > 0.1 &&
          (parseInt(style.zIndex) > 10 ||
            style.position === "fixed" ||
            style.position === "sticky")
        );
      });
      if (overlays.length === 0) return false;

      // Close-button heuristic: interactive elements inside an overlay
      // that look like a dismiss button, scored by their distance from
      // the overlay's top-right corner (lower = closer = better candidate).
      const CLOSE_TEXTS = new Set(["×", "✕", "✖", "x", "close", "dismiss", "cerrar", "no thanks", "no, thanks", "skip"]);
      let bestEl: Element | null = null;
      let bestScore = Infinity;

      for (const overlay of overlays) {
        const or = overlay.getBoundingClientRect();
        const topRight = { x: or.right, y: or.top };

        const candidates = Array.from(
          overlay.querySelectorAll("button, a, [role='button'], input[type='checkbox'], span, div"),
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          // Must be in the top half of the overlay and right 60% of it
          return r.top < or.top + or.height * 0.5 && r.right > or.left + or.width * 0.4;
        });

        for (const el of candidates) {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dist = Math.hypot(cx - topRight.x, cy - topRight.y);

          const text = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.className || "")
            .trim().toLowerCase();
          const looksLikeClose =
            CLOSE_TEXTS.has(text) ||
            text.length <= 3 ||                          // short text → likely ×
            el.className.toLowerCase().includes("close") ||
            el.className.toLowerCase().includes("dismiss") ||
            (el.getAttribute("aria-label") || "").toLowerCase().includes("close");

          // Score: distance from top-right corner, penalised if not close-like
          const score = dist * (looksLikeClose ? 1 : 3);
          if (score < bestScore) {
            bestScore = score;
            bestEl = el;
          }
        }
      }

      if (bestEl && bestScore < vw * 0.8) {
        (bestEl as HTMLElement).click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!clicked) break; // no overlay found — done
    await page.waitForTimeout(500).catch(() => {});
  }
}

/**
 * Tries to expose a search input even when it isn't visible by
 * default. Some themes (Squarespace, custom CMS templates) hide the
 * input behind a magnifying-glass icon — clicking the icon reveals
 * the input or navigates to a dedicated /search page. We detect the
 * trigger, click it, and re-locate the input.
 */
async function locateOrOpenSearchInput(
  page: Page,
  rootUrl: string,
): Promise<SearchInputResult> {
  // 1) Direct — happy path.
  const direct = await findInputBySelectors(page);
  if (direct) {
    return { handle: direct, discovery: "direct", note: "Search input visible on the page." };
  }

  // 2) Find a search-trigger to click.
  const triggerSelectors = [
    'button[aria-label*="search" i]',
    'button[aria-label*="buscar" i]',
    'a[aria-label*="search" i]',
    'a[aria-label*="buscar" i]',
    '[role="button"][aria-label*="search" i]',
    '[role="button"][aria-label*="buscar" i]',
    'a[href*="/search" i]',
    'a[href*="/buscar" i]',
    "button.search-toggle",
    "[class*='search-toggle']",
    "[class*='search-trigger']",
    "[class*='search-icon']",
    "[class*='SearchIcon']",
    '[data-action*="search" i]',
    // Drawer / off-canvas pattern (e.g. GeneratePress + Elementor)
    '[data-toggle-target*="search" i]',
    '[data-target*="search" i]',
    '[data-micromodal-trigger*="search" i]',
  ];
  let trigger: import("playwright").ElementHandle | null = null;
  for (const sel of triggerSelectors) {
    const h = await page.$(sel);
    if (h) {
      const visible = await h.isVisible().catch(() => false);
      if (visible) {
        trigger = h;
        break;
      }
    }
  }

  // 3) Text-content fallback: any <a> or <button> whose visible text is
  //    only "Search" / "Buscar" / "Find" etc.
  if (!trigger) {
    trigger = await page.evaluateHandle(() => {
      const targets = Array.from(
        document.querySelectorAll("a, button"),
      ) as HTMLElement[];
      for (const el of targets) {
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (
          (text === "search" || text === "buscar" || text === "find") &&
          el.offsetParent !== null
        ) {
          return el;
        }
      }
      return null;
    }).then((j) => j.asElement() as import("playwright").ElementHandle | null);
  }

  if (!trigger) {
    return {
      handle: null,
      discovery: "missing",
      note:
        "No visible search input and no search trigger (icon button, link, or text button) could be found on the homepage.",
    };
  }

  // 3.5) Dismiss overlays — acts like a human: press Escape, then look for
  //   the X / close button in the top-right corner of any large overlay.
  //   Runs up to 3 times so stacked popups are cleared one by one.
  await dismissOverlays(page);

  // 4) Click and wait for either the input to appear or the page to
  //    navigate to a search-style URL.
  const beforeUrl = page.url();
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await trigger.click({ timeout: 3500 });
  } catch {
    // One more attempt: force-click bypasses interactability checks
    try {
      await trigger.click({ force: true, timeout: 2000 });
    } catch {
      return {
        handle: null,
        discovery: "missing",
        note: "Found a search trigger but clicking it threw an error.",
      };
    }
  }
  await page
    .waitForLoadState("domcontentloaded", { timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(700);

  const afterDirect = await findInputBySelectors(page);
  if (afterDirect) {
    const afterUrl = page.url();
    if (afterUrl !== beforeUrl) {
      return {
        handle: afterDirect,
        discovery: "trigger_navigated",
        note: `The homepage had no visible search input. Clicking the search trigger navigated to "${afterUrl}" where an input is available — extra step that costs conversions.`,
      };
    }
    return {
      handle: afterDirect,
      discovery: "trigger_revealed",
      note:
        "The homepage's search input is hidden behind a magnifying-glass icon. Clicking it revealed the input — the input is not directly visible.",
    };
  }

  // Last-ditch: if we navigated, the new page might already function
  // as a search box (URL query → server-rendered results). Just report
  // that without an input.
  if (page.url() !== beforeUrl) {
    return {
      handle: null,
      discovery: "trigger_navigated",
      note: `Search trigger navigated to "${page.url()}" but no input was found there either — the site may use a server-rendered search form we don't recognize.`,
    };
  }

  return {
    handle: null,
    discovery: "missing",
    note:
      "Clicked the search trigger but no input appeared and no navigation occurred. Likely a JS-only search that uses a custom widget.",
  };
}

// Back-compat shim — older callers expect a bare handle. New callers
// (the main probe flow) use locateOrOpenSearchInput directly.
async function findSearchInput(page: Page) {
  return findInputBySelectors(page);
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
  /** 0-100 confidence in the resultsPresent verdict (see EntryVariantResult docs). */
  confidence: number;
  /** Human-readable verdict reason. */
  verdictReason: string;
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
  variantType?: string,
): Promise<SearchOutcome> {
  try {
    // Always re-navigate to root to get a clean state.
    await safeGoto(page, rootUrl);
    const located = await locateOrOpenSearchInput(page, rootUrl);
    const input = located.handle;
    if (!input) {
      return {
        resultsPresent: false,
        estimate: null,
        hasFallbackContent: false,
        hardError: true,
        topResultNames: [],
        screenshot: null,
        confidence: 100,
        verdictReason: `Search box not found on the page — ${located.note}`,
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
      // Broader phrase list — covers WooCommerce, Shopify, BigCommerce,
      // generic CMS templates, and custom carts. Each entry is a
      // contiguous lowercase substring we look for in the body text.
      const noResultsPhrases = [
        "no results",
        "no resultados",
        "sin resultados",
        "0 results",
        "0 productos",
        "no products found",
        "no products were found",
        "no items found",
        "no items match",
        "no matches found",
        "no matching",
        "no se encontraron",
        "did not match",
        "did not find",
        "nothing found",
        "we couldn't find",
        "we could not find",
        "we didn't find",
        "your search returned no",
        "your search did not match",
      ];
      const hasNoResultsCopy = noResultsPhrases.some((p) => bodyText.includes(p));

      // Step 1 — explicit known selectors (precise count when the site
      // uses a recognized e-commerce platform's markup).
      const resultSelectors = [
        "ul.products li.product",
        ".products .product",
        ".product-grid .product",
        "[data-search-result]",
        ".search-result",
        ".search-results .item",
        ".search-results > *",
        ".instantsearch-hit",
        ".algolia-autocomplete .product",
        ".collection-grid .product-card",
        ".product-list .product-item",
        // Custom-cart heuristics
        ".product-tile",
        "[class*='product-card']",
        "[class*='product-item']",
        "[class*='SearchResult']",
      ];
      let resultEls: Element[] = [];
      let estimate = 0;
      for (const sel of resultSelectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.length > estimate) {
            estimate = els.length;
            resultEls = els;
          }
        } catch {
          // Invalid selector on this browser — skip.
        }
      }

      // Step 2 — generic fallback: any anchor in the main content area
      // that wraps an <img> and points to what looks like a product page.
      // Catches sites like fastcap.com that use custom <a><img><p>name</p></a>
      // markup with no recognizable class names.
      if (estimate === 0 && !hasNoResultsCopy) {
        const productLinkPattern = /\/(product|products|item|p|shop)\b/i;
        const anchorsWithImg = Array.from(
          document.querySelectorAll("a"),
        ).filter((a) => {
          if (!a.querySelector("img")) return false;
          const href = a.getAttribute("href") ?? "";
          // External or non-product links are noise (social icons, etc.)
          if (!href || href.startsWith("#")) return false;
          if (/(facebook|twitter|instagram|youtube|pinterest|linkedin)\.com/i.test(href))
            return false;
          // Either the href looks like a product URL, or the anchor sits
          // beneath a "results" heading.
          if (productLinkPattern.test(href)) return true;
          // Walk up to see if a search-results heading is an ancestor sibling.
          let cur: Element | null = a;
          for (let i = 0; i < 6 && cur; i++) {
            cur = cur.parentElement;
            const prev = cur?.previousElementSibling;
            const prevText = prev?.textContent?.toLowerCase() ?? "";
            if (
              /(search results|resultados|matching|products|productos)/i.test(prevText)
            ) {
              return true;
            }
          }
          return false;
        });
        // Dedupe by href so an anchor wrapping both image AND text doesn't
        // count twice when the markup is split.
        const seen = new Set<string>();
        const unique = anchorsWithImg.filter((a) => {
          const h = a.getAttribute("href") ?? "";
          if (seen.has(h)) return false;
          seen.add(h);
          return true;
        });
        if (unique.length > 0) {
          resultEls = unique as Element[];
          estimate = unique.length;
        }
      }

      // Step 3 — extract result names. Try title-class selectors first,
      // then fall back to the anchor's own text content (covers
      // <a><img><p>Name</p></a> patterns).
      const nameSelectors = [
        ".woocommerce-loop-product__title",
        ".product-title",
        ".product-name",
        ".product-card__title",
        "h2.product__title",
        "h3.product-card__heading",
        "[class*='product-title']",
        "[class*='product-name']",
        "h2",
        "h3",
        "h4",
        "p",
      ];
      const names: string[] = [];
      for (const el of resultEls.slice(0, 10)) {
        let found: string | null = null;
        for (const sel of nameSelectors) {
          const nameEl = el.querySelector(sel);
          const text = nameEl?.textContent?.trim();
          if (text && text.length > 2 && text.length < 200) {
            found = text;
            break;
          }
        }
        // Last resort: the anchor's own visible text (strip whitespace).
        if (!found) {
          const own = el.textContent?.replace(/\s+/g, " ").trim();
          if (own && own.length > 2 && own.length < 200) found = own;
        }
        if (found) names.push(found);
      }

      const hasFallbackContent =
        document.body.innerText.length > 600 && !hasNoResultsCopy;

      // Return the raw signals; the verdict + confidence is computed
      // back in Node so we can keep the logic out of page.evaluate
      // (easier to test, easier to extend).
      return {
        estimate: estimate > 0 ? estimate : null,
        hasFallbackContent,
        hasNoResultsCopy,
        matchedNoResultsPhrase: noResultsPhrases.find((p) =>
          bodyText.includes(p),
        ) ?? null,
        topResultNames: names,
        currentUrl: window.location.href,
      };
    });

    const verdict = classifyResults({
      query,
      variantType,
      estimate: domResult.estimate,
      hasNoResultsCopy: domResult.hasNoResultsCopy,
      matchedNoResultsPhrase: domResult.matchedNoResultsPhrase,
      topResultNames: domResult.topResultNames,
      currentUrl: domResult.currentUrl,
    });

    // When the input wasn't directly visible, dock confidence and
    // annotate the verdict reason so the report flags this as a UX
    // issue. A search box that requires an extra click costs
    // conversions even if the search itself works once you find it.
    let finalConfidence = verdict.confidence;
    let finalReason = verdict.reason;
    if (located.discovery === "trigger_revealed") {
      finalConfidence = Math.max(0, finalConfidence - 15);
      finalReason =
        `UX issue: search input is hidden behind an icon and only appears after a click. ${finalReason}`;
    } else if (located.discovery === "trigger_navigated") {
      finalConfidence = Math.max(0, finalConfidence - 10);
      finalReason =
        `UX issue: the homepage has no search input — clicking the search icon navigated to a dedicated search page first. ${finalReason}`;
    }

    return {
      resultsPresent: verdict.resultsPresent,
      estimate: domResult.estimate,
      hasFallbackContent: domResult.hasFallbackContent,
      hardError: false,
      topResultNames: domResult.topResultNames,
      screenshot,
      confidence: finalConfidence,
      verdictReason: finalReason,
    };
  } catch (e) {
    return {
      resultsPresent: false,
      estimate: null,
      hasFallbackContent: false,
      hardError: true,
      topResultNames: [],
      screenshot: null,
      confidence: 0,
      verdictReason: `Probe threw an exception: ${String(e).slice(0, 120)}`,
    };
  }
}

/**
 * Classify a search query's outcome with a confidence score (0-100)
 * and a human-readable reason. Runs in Node (outside page.evaluate) so
 * it's easy to extend with future signals (e.g. URL-encoded query check,
 * Claude vision pass).
 *
 * Decision tree:
 *   1. Explicit "no results" copy   → no results, 100% confident
 *   2. Cards present + names match  → results, 95% confident
 *   3. Cards present + names don't  → no results (fallback), 70%
 *   4. Cards present + no names     → results, 70% (couldn't verify)
 *   5. URL contains query           → results, 60%
 *   6. Nothing                      → no results, 60%
 *
 * Synonyms are a special case: by definition the result names *won't*
 * contain the synonym token. We detect that here and avoid penalizing
 * synonym tests for irrelevant-name signals.
 */
function classifyResults(args: {
  query: string;
  variantType?: string;
  estimate: number | null;
  hasNoResultsCopy: boolean;
  matchedNoResultsPhrase: string | null;
  topResultNames: string[];
  currentUrl: string;
}): { resultsPresent: boolean; confidence: number; reason: string } {
  const { query, variantType, estimate, hasNoResultsCopy, matchedNoResultsPhrase, topResultNames, currentUrl } = args;
  const count = estimate ?? 0;
  // Synonym tests can't use the query-token relevance check — by
  // definition, the synonym word ("Tapeline") *won't* appear in the
  // result names ("Tape Measure"). For synonyms we trust the card
  // count alone, with reduced confidence.
  const isSynonym = variantType === "synonym";

  // 1. Explicit no-results copy is the strongest signal we have.
  if (hasNoResultsCopy) {
    return {
      resultsPresent: false,
      confidence: 100,
      reason: matchedNoResultsPhrase
        ? `Page explicitly says no results — matched phrase: "${matchedNoResultsPhrase}".`
        : "Page contains explicit no-results copy.",
    };
  }

  // Tokens of the query for relevance check. Skip tokens shorter than
  // 3 characters (noise like "is", "to").
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3);

  const relevantNames = topResultNames.filter((n) =>
    tokens.some((t) => n.toLowerCase().includes(t)),
  );
  const queryInUrl = tokens.length > 0
    ? tokens.some((t) => currentUrl.toLowerCase().includes(t))
    : false;

  // 2. Cards + at least one name contains a query token → very likely real hits.
  if (count > 0 && relevantNames.length > 0) {
    const ratio = relevantNames.length / topResultNames.length;
    let confidence = 95;
    if (queryInUrl) confidence = Math.min(100, confidence + 3);
    return {
      resultsPresent: true,
      confidence,
      reason:
        `Found ${count} result card(s); ${relevantNames.length} of ${topResultNames.length} ` +
        `top-result name(s) match query tokens (e.g. "${relevantNames[0]}"). ` +
        (queryInUrl ? "URL also contains the query. " : "") +
        `Relevance ratio ${Math.round(ratio * 100)}%.`,
    };
  }

  // 3. Cards present, names extracted, none match query.
  //    - Non-synonym variants: likely fallback content. No-results.
  //    - Synonym variants: by design the synonym word won't appear in
  //      result names — trust the cards but mark lower confidence so
  //      a human reviews whether the products are semantically related.
  if (count > 0 && topResultNames.length > 0) {
    if (isSynonym) {
      return {
        resultsPresent: true,
        confidence: 65,
        reason:
          `Found ${count} card(s); top result(s): "${topResultNames.slice(0, 3).join('", "')}". ` +
          `Synonym tests can't be auto-verified for semantic match — ` +
          `confirm manually that these are the products the canonical query would return.`,
      };
    }
    return {
      resultsPresent: false,
      confidence: 70,
      reason:
        `Found ${count} card(s) on the page but none of the ${topResultNames.length} ` +
        `extracted name(s) contain query tokens — likely a fallback grid ` +
        `(popular products / recommendations) rather than real hits.`,
    };
  }

  // 4. Cards present but no names extracted → moderate-confidence
  //    results-true (couldn't verify relevance, but the cards exist).
  if (count > 0) {
    return {
      resultsPresent: true,
      confidence: 70,
      reason:
        `Found ${count} card(s) on the page but couldn't extract their ` +
        `names to verify relevance to the query. Confidence is reduced — ` +
        `flag for manual review.`,
    };
  }

  // 5. No cards, but query appears in URL → probably search ran but the
  //    site doesn't expose visible cards in markup we recognize.
  if (queryInUrl) {
    return {
      resultsPresent: false,
      confidence: 55,
      reason:
        `No product cards detected and no explicit "no results" copy, ` +
        `but the URL reflects the query — the site likely uses a custom ` +
        `search-engine layout. Flag for manual review.`,
    };
  }

  // 6. No signals either way.
  return {
    resultsPresent: false,
    confidence: 60,
    reason:
      "No product-like elements detected and no explicit no-results copy. " +
      "The search engine may use a non-standard layout. Flag for manual review.",
  };
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
