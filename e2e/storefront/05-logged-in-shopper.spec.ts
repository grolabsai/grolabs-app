import { test, expect } from "@playwright/test";
import { db, latestQueryLog, waitForRow, TEST_INSTANCE_ID, assertInstanceId } from "../lib/db";
import { dismissPopups, RUN_ID, tagged } from "../lib/run";

/**
 * Logged-in shopper identity (test matrix B): a WooCommerce customer's
 * searches and events must carry account_id — an opaque SHA-256, never raw
 * PII — alongside the anonymous browser id, so one human stitches across
 * sessions and devices.
 *
 * Needs a WP customer account on the test store. Storefront registration is
 * DISABLED on grolabs.io, so create one in wp-admin (Users → Add New, role
 * Customer) and put the credentials in .env.local:
 *
 *   E2E_SHOPPER_EMAIL=...
 *   E2E_SHOPPER_PASSWORD=...
 *
 * The spec skips itself until both are present.
 */

const EMAIL = process.env.E2E_SHOPPER_EMAIL;
const PASSWORD = process.env.E2E_SHOPPER_PASSWORD;

test("logged-in shopper searches carry a hashed account_id", async ({ page }) => {
  test.skip(
    !EMAIL || !PASSWORD,
    "E2E_SHOPPER_EMAIL / E2E_SHOPPER_PASSWORD not set — create a WP customer (wp-admin → Users → Add New) and add them to .env.local",
  );

  // Storefront login via the my-account form. The theme also renders a
  // hidden header login DRAWER with duplicate field ids — .first() targets
  // the page form (first in DOM).
  await page.goto(tagged("/my-account/"));
  await dismissPopups(page);
  await page.locator("#username").first().fill(EMAIL!);
  await page.locator("#password").first().fill(PASSWORD!);
  await page.locator('button[name="login"]').first().click();
  // Successful login re-renders my-account with the logout link.
  await expect(
    page.locator(".woocommerce-MyAccount-navigation, a[href*='customer-logout']").first(),
  ).toBeVisible({ timeout: 15_000 });

  // A committed search while logged in (unique term to dodge the plugin's
  // 5-minute results transient).
  const term = `dog logged-${RUN_ID}`;
  const since = new Date().toISOString();
  await page.goto(tagged(`/?s=${encodeURIComponent(term)}&post_type=product`));

  const row = await waitForRow(() => latestQueryLog(term, since, { is_committed: true }), {
    label: "committed query_log row for the logged-in shopper",
  });
  expect(row.user_id, "browser id still present when logged in").not.toBeNull();

  const { data } = await db()
    .from("query_log")
    .select("account_id")
    .eq("instance_id", assertInstanceId(TEST_INSTANCE_ID))
    .eq("id", row.id)
    .single();
  const accountId = (data as { account_id: string | null } | null)?.account_id ?? null;
  expect(accountId, "logged-in searches must carry account_id").not.toBeNull();
  // Opaque hash, never raw PII: 64 hex chars, and never the email itself.
  expect(accountId).toMatch(/^[0-9a-f]{64}$/);
  expect(accountId).not.toContain("@");
});
