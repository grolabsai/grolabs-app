/**
 * Prospectos v5 — optional browser-backed HTML fetch for the FETCH evidence path.
 *
 * When PROSPECTOS_FETCH_VIA_BROWSER=1 (and Browserless credentials are present),
 * `fetchHtmlViaBrowser` renders the page in a real Chromium via Playwright over
 * CDP. This bypasses bot-protection and JS-gated content that plain `fetch()`
 * can't reach (Cloudflare challenges, 429 rate-limits on the homepage, etc.).
 *
 * When the flag is off, or when credentials are absent, all callers fall back
 * to the existing plain-fetch path transparently — no behaviour change.
 *
 * Flag:  PROSPECTOS_FETCH_VIA_BROWSER=1  (off by default)
 * Deps:  BROWSERLESS_HOST + BROWSERLESS_TOKEN  (same vars as browser-probe.ts)
 *        Playwright must be installed (it already is — browser-probe.ts uses it)
 *
 * Usage:
 *   import { fetchHtmlViaBrowser, BROWSER_FETCH_ENABLED } from "./browser-fetch";
 *   const result = await fetchHtmlViaBrowser(url);  // { ok, body, status }
 */

const BROWSER_FETCH_ENABLED =
  process.env.PROSPECTOS_FETCH_VIA_BROWSER === "1";
const BROWSERLESS_HOST = process.env.BROWSERLESS_HOST;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

/** Whether the browser-fetch path is active (flag on + credentials present). */
export const FETCH_VIA_BROWSER =
  BROWSER_FETCH_ENABLED && !!BROWSERLESS_HOST && !!BROWSERLESS_TOKEN;

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
 * Render `url` in a real Chromium (via Browserless CDP or local launch) and
 * return the page's serialised HTML. Falls back gracefully on any error.
 *
 * Only call this when FETCH_VIA_BROWSER is true — the caller is responsible
 * for checking.
 */
export async function fetchHtmlViaBrowser(
  url: string,
): Promise<BrowserFetchResult> {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (e) {
    return { ok: false, status: null, note: "playwright_unavailable", url };
  }

  let browser = null;
  let weLaunched = false;
  try {
    const wsUrl = buildWsUrl();
    if (wsUrl) {
      browser = await playwright.chromium.connectOverCDP(wsUrl);
    } else {
      // Local dev fallback when credentials aren't set yet
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
      } catch {
        /* ignore */
      }
    });

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS,
      });
    } catch (e) {
      // Timeout or navigation error — still try to grab whatever loaded
      console.warn(`[browser-fetch] goto timeout/error for ${url}:`, String(e).slice(0, 120));
    }

    const body = await page.content();
    await ctx.close();

    if (!body || body.length < 100) {
      return { ok: false, status: httpStatus, note: "empty_page", url };
    }

    return { ok: true, body, status: httpStatus ?? 200, url };
  } catch (e) {
    const note = `browser_fetch_failed:${String(e).slice(0, 120)}`;
    console.warn(`[browser-fetch] ${url}:`, note);
    return { ok: false, status: null, note, url };
  } finally {
    try {
      if (browser && weLaunched) await browser.close();
      else if (browser && !weLaunched) await (browser as import("playwright").Browser).close().catch(() => {});
    } catch {
      /* ignore */
    }
  }
}
