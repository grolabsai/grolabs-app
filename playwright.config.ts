import { defineConfig } from "@playwright/test";

/**
 * Smoke-test config. These tests hit a DEPLOYED environment (production by
 * default, or a preview URL via env) — they do not start the app. The point is
 * to prove that the important authenticated pages actually render, catching the
 * class of bug that build + typecheck cannot (a runtime render crash like a
 * missing React provider).
 *
 * Two hosts → two projects, because the admin and RRE surfaces are separate
 * domains with separate auth cookies. Each project logs in once (a `*-setup`
 * dependency that saves storageState) and reuses that session for its routes.
 *
 * Required env (set as GitHub secrets — see tests/smoke/README.md):
 *   SMOKE_EMAIL, SMOKE_PASSWORD   — a settled test account with a password set
 * Optional overrides (default to production):
 *   ADMIN_URL  (default https://admin.grolabs.ai)
 *   APP_URL    (default https://app.grolabs.ai)
 */
const ADMIN_URL = process.env.ADMIN_URL || "https://admin.grolabs.ai";
const APP_URL = process.env.APP_URL || "https://app.grolabs.ai";

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    {
      name: "admin-setup",
      testMatch: /admin\.setup\.ts/,
      use: { baseURL: ADMIN_URL },
    },
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      dependencies: ["admin-setup"],
      use: { baseURL: ADMIN_URL, storageState: "playwright/.auth/admin.json" },
    },
    {
      name: "app-setup",
      testMatch: /app\.setup\.ts/,
      use: { baseURL: APP_URL },
    },
    {
      name: "app",
      testMatch: /app\.spec\.ts/,
      dependencies: ["app-setup"],
      use: { baseURL: APP_URL, storageState: "playwright/.auth/app.json" },
    },
  ],
});
