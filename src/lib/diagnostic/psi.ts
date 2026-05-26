/**
 * Google PageSpeed Insights API wrapper for Core Web Vitals.
 *
 * Free tier works without an API key but throttles aggressively
 * (~25 req/day per IP). Set GOOGLE_PSI_API_KEY in production to lift
 * the limit. Failure to fetch (rate limit, network, anything) returns
 * null so the CWV scorer degrades to 'error' rather than blocking the
 * whole run.
 *
 * Strategy: query the "lab" Lighthouse audit on mobile, which gives
 * LCP/CLS/INP estimates that are deterministic per URL (vs CrUX field
 * data which requires the URL to have public traffic).
 */

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 30_000; // Lighthouse audits can take 15-25s

export type CoreWebVitals = {
  url: string;
  strategy: "mobile" | "desktop";
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  performance_score: number | null; // 0..1 from Lighthouse
  source: "lab" | "field" | "mixed";
  fetched_at: string;
};

export async function fetchCoreWebVitals(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<CoreWebVitals | null> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: "performance",
  });
  if (process.env.GOOGLE_PSI_API_KEY) {
    params.set("key", process.env.GOOGLE_PSI_API_KEY);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[psi] non-ok response: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Record<string, unknown>;
    return parsePsi(url, strategy, json);
  } catch (e) {
    console.warn("[psi] fetch failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parsePsi(
  url: string,
  strategy: "mobile" | "desktop",
  json: Record<string, unknown>,
): CoreWebVitals {
  const lighthouseResult = (json.lighthouseResult ?? {}) as Record<string, unknown>;
  const audits = (lighthouseResult.audits ?? {}) as Record<string, { numericValue?: number }>;
  const categories = (lighthouseResult.categories ?? {}) as Record<string, { score?: number }>;

  const lcp = audits["largest-contentful-paint"]?.numericValue ?? null;
  const cls = audits["cumulative-layout-shift"]?.numericValue ?? null;
  // PSI returns "experimental-interaction-to-next-paint" or
  // "total-blocking-time" as a proxy depending on availability.
  const inp =
    audits["experimental-interaction-to-next-paint"]?.numericValue ??
    audits["interaction-to-next-paint"]?.numericValue ??
    null;
  const performance = categories.performance?.score ?? null;

  // CrUX "loadingExperience" carries field data when present.
  const loadingExperience = (json.loadingExperience ?? {}) as {
    metrics?: Record<string, { percentile?: number }>;
  };
  const hasField = !!loadingExperience.metrics?.LARGEST_CONTENTFUL_PAINT_MS;
  const source = hasField ? "mixed" : "lab";

  return {
    url,
    strategy,
    lcp_ms: lcp,
    cls,
    inp_ms: inp,
    performance_score: performance,
    source,
    fetched_at: new Date().toISOString(),
  };
}
