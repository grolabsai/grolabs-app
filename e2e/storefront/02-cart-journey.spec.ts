import { test, expect } from "@playwright/test";
import { latestEvent, waitForRow } from "../lib/db";
import { dismissPopups, tagged } from "../lib/run";

/**
 * Cart journey (test matrix B, beyond add-to-cart): checkout start and
 * cart removal, each asserted against analytics_event.
 *
 *  - proceed to checkout → conversion "Proceeded to check out" + cart_id
 *    (fires per cart item on checkout-page load, session-deduped by item set)
 *  - remove from cart    → cart_remove "Removed from cart", own store only
 *
 * Order COMPLETION is a separate spec once the store has a payment gateway —
 * as of 2026-07-14 grolabs.io has none enabled ("no available payment
 * methods"), so placing an order is impossible. Enable Cash on Delivery in
 * WooCommerce → Settings → Payments to unlock it.
 *
 * Product 266 is a known simple, in-stock product in the seeded catalog
 * (?add-to-cart=<id> adds it without variation selection).
 */

const SIMPLE_PRODUCT_ID = process.env.E2E_SIMPLE_PRODUCT_ID || "266";

test.describe("cart journey (analytics_event)", () => {
  test("reaching checkout records a checkout-started conversion", async ({ page }) => {
    // Seed the cart, then land on checkout — the plugin fires the
    // "Proceeded to check out" conversion from the checkout-page context.
    await page.goto(tagged(`/?add-to-cart=${SIMPLE_PRODUCT_ID}`));
    await dismissPopups(page);

    const since = new Date().toISOString();
    await page.goto(tagged("/checkout/"));
    await dismissPopups(page);

    const row = await waitForRow(() => latestEvent("conversion", since), {
      label: "checkout-started conversion",
    });
    expect(row.event_name).toBe("Proceeded to check out");
    expect(row.object_id).toBe(SIMPLE_PRODUCT_ID);
    expect(row.cart_id, "checkout conversion must thread the cart identity").not.toBeNull();
  });

  test("removing a cart item records a cart_remove event", async ({ page }) => {
    await page.goto(tagged(`/?add-to-cart=${SIMPLE_PRODUCT_ID}`));
    await dismissPopups(page);

    const since = new Date().toISOString();
    await page.goto(tagged("/cart/"));
    await dismissPopups(page);

    // WC standard remove control inside the cart form (scoped so a mini-cart
    // widget's remove link can't be picked up by accident).
    const remove = page
      .locator(".woocommerce-cart-form a.remove, .woocommerce-cart-form .remove_from_cart_button")
      .first();
    await remove.waitFor({ state: "visible", timeout: 10_000 });
    await remove.click();

    const row = await waitForRow(() => latestEvent("cart_remove", since), {
      label: "cart_remove event",
    });
    expect(row.event_name).toBe("Removed from cart");
    expect(row.object_id).toBe(SIMPLE_PRODUCT_ID);
    // Removals are own-store only — they must never carry search lineage
    // (Meilisearch's funnel has no removal concept; see event-tracking.md).
    expect(row.query_uid).toBeNull();
  });
});
