import { type Page, expect } from "@playwright/test";

/**
 * Authenticated routes to smoke. Keep these to the high-traffic, must-not-be-
 * broken pages — the goal is "does the shell render," not full coverage. Add a
 * route here whenever a page breaking would be a production incident.
 */
export const ADMIN_PATHS = [
  "/prospects",
  "/prospects/rubric",
  "/prospects/benchmarks",
  "/clientes",
];

export const APP_PATHS = [
  "/dashboard/traffic",
  "/dashboard/search",
  "/catalog/products",
  "/catalog/categories",
  "/configuration/algolia",
  "/configuration/ga4",
];

/**
 * Log in through the real email+password form (SSO can't be automated). Saves
 * nothing — the caller persists storageState. Throws a clear message if the
 * credentials are missing or the account isn't in a testable state.
 */
export async function login(page: Page, baseURL: string): Promise<void> {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SMOKE_EMAIL / SMOKE_PASSWORD are not set. See tests/smoke/README.md.",
    );
  }

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  const path = new URL(page.url()).pathname;
  if (path.endsWith("/login")) {
    throw new Error(
      "Login did not leave /login — check SMOKE_EMAIL/SMOKE_PASSWORD (the account needs a password set, not just SSO).",
    );
  }
  if (path.includes("cambiar-contrasena")) {
    throw new Error(
      "Test account is stuck on the forced password-change screen — complete that once so it's a settled account.",
    );
  }
}

/**
 * Assert a page rendered without hitting the error boundary or losing the
 * session. Pair with a console-error check in the spec for full coverage.
 */
export async function assertHealthy(page: Page, path: string): Promise<void> {
  await expect(
    page.getByText("Something went wrong on this page"),
    `error boundary rendered on ${path}`,
  ).toHaveCount(0);

  const here = new URL(page.url()).pathname;
  expect(here.endsWith("/login"), `bounced to /login on ${path} (session lost)`).toBe(
    false,
  );
}
