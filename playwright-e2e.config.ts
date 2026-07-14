import { defineConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

/**
 * E2E page-test config (the 🎭 tier of the MVP-testing plan — see the
 * "Playwright E2E harness" section of docs/design/testing-approach.md and the
 * MVP Testing page in Notion).
 *
 * These tests drive the LIVE WordPress storefront (grolabs.io → instance 12,
 * the designated test site per docs/state/instances.md) and then assert the
 * rows land in Supabase via the service-role client. Collection and reading
 * are verified in one test.
 *
 * Requires .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 * for the DB asserts — loadEnvConfig pulls it in the Next.js way.
 *
 * GA4 constraints (ratified in the plan): run HEADED real Chrome — headless
 * UAs contain "HeadlessChrome" and GA4 bot-filters them — and tag every
 * navigation with utm_source=e2e-playwright so test sessions stay
 * identifiable (and excludable from customer reporting later).
 */
loadEnvConfig(__dirname);

// Canonical APEX origin, deliberately. WordPress 301s normal pages from www
// to apex but serves search URLs (?s=) in place on www — so a www baseURL
// splits the shopper identity across two origins (host-only grolabs_bid
// cookie + per-origin localStorage) and committed searches lose their
// user_id. Real-merchant fix tracked separately: mint the cookie with
// Domain=.<registrable-domain> in the plugin.
const STOREFRONT_URL = process.env.STOREFRONT_URL || "https://grolabs.io";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  // Journey specs assert on rows created during their own time window; run
  // them one at a time so windows never overlap.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: STOREFRONT_URL,
    channel: "chrome",
    headless: false,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
