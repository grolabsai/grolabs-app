/**
 * Auto-discover sample URLs from the prospect's homepage.
 *
 * When the user supplies only the root URL, we want to:
 *   - Pick one PDP to score (preferring a featured / best-seller product)
 *   - Pick one category/listing page to score faceting against
 *
 * Static HTML only (this runs alongside probeSiteWide, before the
 * browser probe). Returns null URLs if nothing reasonable is found —
 * the runner then falls back to the root as PDP and skips faceting.
 *
 * Heuristics:
 *   - PDP candidates: hrefs that look like `/product/...`, `/p/...`,
 *     `/products/...`, `/producto/...`. Featured-section selectors
 *     (.featured, .hero, .home-featured) bias the pick.
 *   - Category candidates: hrefs that look like `/category/...`,
 *     `/categoria/...`, `/collections/...`, `/c/...`, `/shop/...`.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; ScoutDiagnostic/1.0)";
const TIMEOUT_MS = 8000;

export type DiscoveredSamples = {
  pdpUrl: string | null;
  pdpReason: string;
  categoryUrl: string | null;
  categoryReason: string;
  homepageText: string;
  homepageHints: {
    title?: string;
    h1?: string[];
    h2?: string[];
    productTypes?: string[];
  };
};

const PDP_PATTERNS = [
  /\/product\//i,
  /\/products\//i,
  /\/producto\//i,
  /\/productos\//i,
  /\/p\/[^/]+\/?$/i,
];

const CATEGORY_PATTERNS = [
  /\/category\//i,
  /\/categoria\//i,
  /\/categorias\//i,
  /\/collections\//i,
  /\/collection\//i,
  /\/shop\//i,
  /\/c\//i,
  /\/cat\//i,
];

const FEATURED_HOST_SELECTORS = [
  "featured",
  "best-seller",
  "best_seller",
  "mas-vendido",
  "mas_vendido",
  "destacado",
  "home-featured",
  "hero",
];

export async function discoverSamples(rootUrl: string): Promise<DiscoveredSamples> {
  const empty: DiscoveredSamples = {
    pdpUrl: null,
    pdpReason: "homepage_fetch_failed",
    categoryUrl: null,
    categoryReason: "homepage_fetch_failed",
    homepageText: "",
    homepageHints: {},
  };

  let html = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(rootUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return empty;
    html = await res.text();
  } catch {
    return empty;
  }

  const lower = html.toLowerCase();

  // Extract structured hints first (used by the vertical classifier).
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  const h1 = collectMatches(html, /<h1[^>]*>([^<]+)<\/h1>/gi).slice(0, 4);
  const h2 = collectMatches(html, /<h2[^>]*>([^<]+)<\/h2>/gi).slice(0, 8);
  const productTypes = extractJsonLdProductCategories(html);

  // ── PDP candidate selection ─────────────────────────────────────────────
  // Pull all hrefs, dedupe, normalize.
  const hrefMatches = Array.from(html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi))
    .map((m) => normalizeHref(m[1], rootUrl))
    .filter((u): u is string => !!u);

  const uniqueHrefs = Array.from(new Set(hrefMatches));

  const pdpCandidates = uniqueHrefs.filter((u) =>
    PDP_PATTERNS.some((p) => p.test(new URL(u).pathname)),
  );

  // Prefer ones whose containing markup hints at featured / best-seller.
  let pdpUrl: string | null = null;
  let pdpReason = "homepage_first_pdp_link";

  for (const sig of FEATURED_HOST_SELECTORS) {
    const idx = lower.indexOf(sig);
    if (idx < 0) continue;
    const slice = html.slice(idx, idx + 3000);
    const localHrefs = Array.from(slice.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi))
      .map((m) => normalizeHref(m[1], rootUrl))
      .filter((u): u is string => !!u);
    const found = localHrefs.find((u) =>
      PDP_PATTERNS.some((p) => p.test(new URL(u).pathname)),
    );
    if (found) {
      pdpUrl = found;
      pdpReason = `featured_block:${sig}`;
      break;
    }
  }

  if (!pdpUrl && pdpCandidates.length > 0) {
    pdpUrl = pdpCandidates[0];
  }

  // ── Category candidate selection ────────────────────────────────────────
  const categoryCandidates = uniqueHrefs.filter((u) =>
    CATEGORY_PATTERNS.some((p) => p.test(new URL(u).pathname)),
  );

  const categoryUrl = categoryCandidates[0] ?? null;
  const categoryReason = categoryUrl
    ? "homepage_first_category_link"
    : "no_category_link_found";

  // Strip tags for the snippet text the classifier will read.
  const text = stripTags(html).slice(0, 6000);

  return {
    pdpUrl,
    pdpReason: pdpUrl ? pdpReason : "no_pdp_link_found",
    categoryUrl,
    categoryReason,
    homepageText: text,
    homepageHints: {
      title,
      h1,
      h2,
      productTypes,
    },
  };
}

function normalizeHref(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    // Only same-host links — external don't help diagnose this prospect.
    const baseHost = new URL(base).host;
    if (u.host !== baseHost) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function collectMatches(s: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(re)) {
    const text = stripTags(m[1]).trim();
    if (text) out.push(text);
  }
  return out;
}

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLdProductCategories(html: string): string[] {
  const results: string[] = [];
  const scriptRe = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = flattenJsonLd(data);
      for (const n of nodes) {
        if (!n || typeof n !== "object") continue;
        const node = n as Record<string, unknown>;
        if (typeof node.category === "string") results.push(node.category);
        if (typeof node.productCategory === "string") results.push(node.productCategory);
        if (Array.isArray(node.itemListElement)) {
          for (const item of node.itemListElement) {
            if (item && typeof item === "object") {
              const ii = item as Record<string, unknown>;
              if (typeof ii.name === "string") results.push(ii.name);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from(new Set(results)).slice(0, 10);
}

function flattenJsonLd(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap((x) => flattenJsonLd(x));
  if (node && typeof node === "object" && "@graph" in (node as Record<string, unknown>)) {
    return flattenJsonLd((node as { "@graph": unknown })["@graph"]);
  }
  return [node];
}
