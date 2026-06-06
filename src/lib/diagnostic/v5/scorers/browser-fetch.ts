/**
 * Prospectos v5 — browser-backed HTML fetch for the FETCH evidence path.
 *
 * Strategy: plain fetch first, Browserless retry on `na`.
 *   1. Every HTML fetch (site homepage for OG tags, discovery homepage) starts
 *      with a plain `fetch()` — fast, cheap, works for most sites.
 *   2. If the result is `na` or `error` (bot-protection, Cloudflare challenge,
 *      network timeout) AND Browserless credentials are configured, we
 *      automatically retry the same URL in a real Chromium via Playwright CDP.
 *   3. The Browserless result replaces the failed plain-fetch result.
 *
 * This means:
 *   - Most sites: one fast plain fetch, no Browserless cost.
 *   - Bot-protected sites: plain fetch fails (~8 s timeout) → Browserless retry
 *     (~10 s render) → real results instead of `na`.
 *   - No Browserless credentials: always plain fetch, same as before.
 *
 * Deps (all optional — graceful no-op when absent):
 *   BROWSERLESS_HOST   e.g. "production-sfo.browserless.io"
 *   BROWSERLESS_TOKEN  from your Browserless dashboard
 *   Playwright         already installed (browser-probe.ts uses it)
 */

const BROWSERLESS_HOST = process.env.BROWSERLESS_HOST;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

/** True when Browserless credentials are present (retry path is available). */
export const BROWSERLESS_AVAILABLE =
  !!BROWSERLESS_HOST && !!BROWSERLESS_TOKEN;

/** Result shape — mirrors the plain-fetch path for easy substitution. */
export type BrowserFetchResult =
  | { ok: true; body: string; status: number; url: string }
  | { ok: false; status: number | null; note: string; url: string };

function buildWsUrl(): string | null {
  if (!BROWSERLESS_HOST || !BROWSERLESS_TOKEN) return null;
  const host = BROWSERLESS_HOST.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return `wss://${host}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;
}

const PAGE_TIMEOUT_MS = 20_000; // 20 s — generous for slow e-commerce sites

/**
 * Render `url` in a real Chromium (via Browserless CDP, or local launch as a
 * dev fallback) and return the page's serialised HTML.
 *
 * Called only when plain fetch returned `na`/`error` AND `BROWSERLESS_AVAILABLE`
 * is true. Never throws — returns a typed error result on any failure.
 */
export async function fetchHtmlViaBrowser(
  url: string,
): Promise<BrowserFetchResult> {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return { ok: false, status: null, note: "playwright_unavailable", url };
  }

  let browser = null;
  let weLaunched = false;
  try {
    const wsUrl = buildWsUrl();
    if (wsUrl) {
      browser = await playwright.chromium.connectOverCDP(wsUrl);
    } else {
      // Local dev fallback — no credentials needed, but not viable on Vercel
      browser = await playwright.chromium.launch({ headless: true });
      weLaunched = true;
    }

    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    const page = await ctx.newPage();
    let httpStatus: number | null = null;

    page.on("response", (resp) => {
      try {
        if (resp.url() === url || resp.url().startsWith(url.replace(/\/$/, ""))) {
          httpStatus = resp.status();
        }
      } catch { /* ignore */ }
    });

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS,
      });
    } catch (e) {
      // Timeout or navigation error — still try to grab whatever loaded
      console.warn(`[browser-fetch] goto timeout for ${url}:`, String(e).slice(0, 100));
    }

    const body = await page.content();
    await ctx.close();

    if (!body || body.length < 100) {
      return { ok: false, status: httpStatus, note: "empty_page", url };
    }

    return { ok: true, body, status: httpStatus ?? 200, url };
  } catch (e) {
    const note = `browser_fetch_failed:${String(e).slice(0, 100)}`;
    console.warn(`[browser-fetch] ${url}:`, note);
    return { ok: false, status: null, note, url };
  } finally {
    try {
      if (weLaunched && browser) await browser.close();
    } catch { /* ignore */ }
  }
}
