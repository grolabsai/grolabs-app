import type { Page, BrowserContext } from "@playwright/test";

/**
 * Per-run identity + GA4-safe tagging for the E2E tier.
 *
 * Every navigation carries utm_source=e2e-playwright&utm_campaign=<run id> so
 * the sessions are identifiable in GA4 (and excludable from customer
 * reporting). The next-day freshness job asserts GA4 pickup filtered on this
 * utm — GA4 ingestion lags minutes-to-hours, so that assert does NOT live in
 * the browser specs.
 */
export const RUN_ID =
  process.env.E2E_RUN_ID || `local-${Date.now().toString(36)}`;

export const UTM = {
  utm_source: "e2e-playwright",
  utm_campaign: RUN_ID,
};

/** Append the e2e utm tags to a storefront path or URL. */
export function tagged(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}utm_source=${UTM.utm_source}&utm_campaign=${encodeURIComponent(UTM.utm_campaign)}`;
}

/**
 * The anonymous browser id the plugin mints (`grolabs_bid` cookie). The PHP
 * results-page search and every JS event carry it as userId — it is the key
 * that stitches a journey. Returns null when the plugin hasn't minted one yet
 * (first paint races the JS; navigate once, then read).
 */
export async function browserId(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  const bid = cookies.find((c) => c.name === "grolabs_bid");
  return bid?.value ? decodeURIComponent(bid.value) : null;
}

/**
 * Best-effort dismissal of storefront popups/drawers before interacting.
 * The PetPaw theme ships popup drawers (`.popup-container` +
 * `.popup-toggle-close`), and marketing popups can appear on a delay — any
 * open overlay steals the click meant for the search box or a product card.
 * Escape first (closes most modals), then any visible close toggles. Never
 * fails the test: no popup is the happy path.
 */
export async function dismissPopups(page: Page): Promise<void> {
  try {
    // Escape closes modals/drawers and is a no-op otherwise. Do NOT click
    // `.popup-toggle-close` here — on the PetPaw theme those are drawer
    // TOGGLES that sit in the header at all times; clicking one OPENS a
    // drawer over the page (this broke the first journey run).
    await page.keyboard.press("Escape");
    // Close buttons that only exist inside an already-open overlay.
    const closers = page.locator(".woosc-popup-close:visible, .mfp-close:visible");
    const count = await closers.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await closers.nth(i).click({ timeout: 1_000 }).catch(() => {});
    }
  } catch {
    // best-effort only
  }
}

/** Read the plugin's injected events config from the page, if the plugin is active. */
export async function pluginEventsConfig(
  page: Page,
): Promise<{ apiHost: string; instanceId: string } | null> {
  return page.evaluate(() => {
    const w = window as unknown as {
      GrolabsWordPressSearchEvents?: { apiHost: string; instanceId: string };
    };
    return w.GrolabsWordPressSearchEvents ?? null;
  });
}
