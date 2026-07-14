import { test, expect } from "@playwright/test";
import { latestEvent, waitForRow } from "../lib/db";
import { dismissPopups, tagged } from "../lib/run";

/**
 * Order completion (test matrix B): place a REAL Cash-on-Delivery order on
 * the test storefront and assert the "Completed order" conversion.
 *
 * The event fires client-side on the order-received page (per line item,
 * deduped per order id) and carries the line value + quantity — the client
 * half of the revenue signal. The SERVER-side revenue path (/api/v1/orders)
 * fires on woocommerce_payment_complete / order-status-completed, which a
 * COD order doesn't hit at placement (it parks at "processing") — flipping
 * the order to Completed in wp-admin later exercises that half.
 *
 * Synthetic billing data on the GroLabs-owned test store (instance 12);
 * COD means no money moves.
 */

const SIMPLE_PRODUCT_ID = process.env.E2E_SIMPLE_PRODUCT_ID || "266";

test("placing a COD order records a Completed-order conversion with revenue fields", async ({
  page,
}) => {
  await page.goto(tagged(`/?add-to-cart=${SIMPLE_PRODUCT_ID}`));
  await dismissPopups(page);

  await page.goto(tagged("/checkout/"));
  await dismissPopups(page);

  // Classic (shortcode) checkout. Fill the standard WC billing fields that
  // exist on this store; skip any the theme removed.
  const fill = async (sel: string, value: string) => {
    const field = page.locator(sel);
    if ((await field.count()) > 0 && (await field.first().isVisible().catch(() => false))) {
      await field.first().fill(value);
    }
  };
  await fill("#billing_first_name", "E2E");
  await fill("#billing_last_name", "Playwright");
  await fill("#billing_address_1", "Test Street 123");
  await fill("#billing_city", "Guatemala");
  await fill("#billing_postcode", "01001");
  await fill("#billing_phone", "55555555");
  await fill("#billing_email", "e2e-orders@grolabs.io");

  // COD must be selected (it may be the only gateway and pre-checked).
  const cod = page.locator("#payment_method_cod");
  await cod.waitFor({ state: "attached", timeout: 10_000 });
  if (!(await cod.isChecked().catch(() => false))) {
    await cod.check({ force: true }).catch(() => {});
  }

  const since = new Date().toISOString();
  // WC re-renders the order review via AJAX after field edits; a click during
  // the overlay gets swallowed. Give it a beat, then place the order.
  await page.waitForTimeout(1500);
  await page.locator("#place_order").click();

  // Success = the order-received endpoint. Generous timeout: COD placement
  // does a full server round-trip plus a redirect.
  await page.waitForURL(/order-received/, { timeout: 30_000 });

  const row = await waitForRow(() => latestEvent("conversion", since), {
    label: "Completed-order conversion",
  });
  expect(row.event_name).toBe("Completed order");
  expect(row.object_id).toBe(SIMPLE_PRODUCT_ID);
  expect(row.order_id, "order id must thread the journey").not.toBeNull();
  expect(row.cart_id).not.toBeNull();
  expect(row.user_id).not.toBeNull();
});
