import { test, expect, type Page } from "@playwright/test";
import { latestEvent, latestQueryLog, waitForRow } from "../lib/db";
import { browserId, dismissPopups, RUN_ID, tagged } from "../lib/run";

/**
 * First journey spec (test matrix A + B): drive the real storefront, then
 * assert the rows in Supabase. One spec proves collection AND reading.
 *
 *  - typeahead probe   → query_log is_committed=false
 *  - results-page load → query_log is_committed=true + user_id (grolabs_bid)
 *  - zero-result term  → query_log total_hits=0 (feeds no_result_rate)
 *  - result click      → analytics_event click with query_uid lineage
 *  - add to cart       → analytics_event conversion
 *
 * The click/cart legs need the instance-12 catalog to match the WordPress
 * catalog (Task: seed via WC import). Until then they self-skip with the
 * reason rather than failing on a known gap.
 */

/** A term that exists in the seeded catalog. Override per catalog state. */
const HIT_TERM = process.env.E2E_HIT_TERM || "dog";
/**
 * Unique-per-run committed term. The plugin caches identical results-page
 * searches in a 5-minute transient — a cache hit makes NO API call and writes
 * NO query_log row (manual §6-V3), so repeated runs with a static term
 * false-fail. Meilisearch still returns the HIT_TERM products for the mixed
 * query, so the page renders results.
 */
const COMMITTED_TERM = `${process.env.E2E_HIT_TERM || "dog"} ${RUN_ID}`;
/** Unique-per-run term that can never match anything. */
const MISS_TERM = `zzqx-${RUN_ID}`;

/** WooCommerce search-results URL for a term. */
function resultsUrl(term: string): string {
  return tagged(`/?s=${encodeURIComponent(term)}&post_type=product`);
}

/** The theme's visible search input (same selector list the typeahead binds). */
async function searchInput(page: Page) {
  const input = page
    .locator(
      'form[role="search"] input[name="s"], form.woocommerce-product-search input[type="search"], form.search-form input[name="s"]',
    )
    .first();
  await input.waitFor({ state: "visible" });
  return input;
}

test.describe("search spine (query_log)", () => {
  test("typeahead probe lands uncommitted", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto(tagged("/"));
    await dismissPopups(page);

    const input = await searchInput(page);
    await input.click();
    // Type letter-by-letter so the debounced (200ms) typeahead fires.
    await input.pressSequentially(HIT_TERM, { delay: 120 });

    const row = await waitForRow(
      () => latestQueryLog(HIT_TERM, since, { is_committed: false }),
      { label: `uncommitted query_log row for "${HIT_TERM}"` },
    );
    expect(row.instance_id).toBe(12);
    expect(row.is_committed).toBe(false);
    expect(row.commit_reason).toBe("typeahead");
  });

  test("results-page search lands committed with the browser id", async ({ page, context }) => {
    // Visit home first so the plugin mints grolabs_bid — the PHP search
    // forwards that cookie as user_id (the v0.10.0 identity path).
    await page.goto(tagged("/"));
    await dismissPopups(page);
    await expect.poll(() => browserId(context)).not.toBeNull();
    const bid = await browserId(context);

    const since = new Date().toISOString();
    await page.goto(resultsUrl(COMMITTED_TERM));

    const row = await waitForRow(
      () => latestQueryLog(COMMITTED_TERM, since, { is_committed: true }),
      { label: `committed query_log row for "${COMMITTED_TERM}"` },
    );
    expect(row.commit_reason).toBe("results_page");
    expect(row.user_id, "PHP must forward the grolabs_bid cookie as user_id").toBe(bid);
  });

  test("zero-result search is recorded with total_hits=0", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto(resultsUrl(MISS_TERM));

    const row = await waitForRow(() => latestQueryLog(MISS_TERM, since), {
      label: `query_log row for miss term "${MISS_TERM}"`,
    });
    expect(row.total_hits).toBe(0);
    expect(row.status).toBe(200);
  });
});

test.describe("event spine (analytics_event)", () => {
  test("clicking a result records a click with query lineage", async ({ page }) => {
    const since = new Date().toISOString();
    await page.goto(resultsUrl(HIT_TERM));
    await dismissPopups(page);

    // A VISIBLE product link inside the results loop. The theme renders many
    // ul.products blocks (mega-menu, widgets) whose links are hidden — an
    // unfiltered .first() lands on one of those and false-skips. If the WP
    // catalog and the instance-12 index don't overlap there is genuinely
    // nothing attributable to click — skip with the reason.
    const productLink = page
      .locator("ul.products li.product a.woocommerce-LoopProduct-link:visible")
      .first();
    const hasResults = await productLink
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasResults, "no visible product results — seed instance 12 catalog from the WP store first");

    // Plugin ≥v0.15.0 attributes clicks on the theme's own loop markup via
    // the localized result-set fallback (GrolabsWordPressSearchResults), so
    // the title link — how real shoppers open a product — is exactly what we
    // click. No hover dance, no dependency on the plugin card rendering.
    await productLink.click();

    const row = await waitForRow(() => latestEvent("click", since), {
      label: "click analytics_event",
    });
    expect(row.query_uid, "click must carry the search's query_uid").not.toBeNull();
    expect(row.object_id).not.toBeNull();
    expect(row.position, "position is the GLOBAL result position").not.toBeNull();
  });

  test("add to cart records a conversion", async ({ page }) => {
    await page.goto(resultsUrl(HIT_TERM));
    await dismissPopups(page);

    // This theme's search results use a list layout with NO loop add-to-cart
    // buttons, and most catalog products are variable anyway — so the cart
    // conversion goes through the PDP: open the first result, then add from
    // the product page (the plugin stamps productId from the PDP config).
    const productLink = page
      .locator("ul.products li.product a.woocommerce-LoopProduct-link:visible")
      .first();
    const hasResults = await productLink
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasResults, "no visible product results — seed instance 12 catalog from the WP store first");
    await productLink.click();
    await page.waitForLoadState("domcontentloaded");
    await dismissPopups(page);

    const since = new Date().toISOString();
    const addToCart = page.locator("button.single_add_to_cart_button:not(.disabled)").first();
    const canAdd = await addToCart
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!canAdd, "no enabled add-to-cart on the PDP — product may need a variation selection");

    await addToCart.click();

    const row = await waitForRow(() => latestEvent("conversion", since), {
      label: "conversion analytics_event",
    });
    expect(row.object_id).not.toBeNull();
    // cart_id arrives with plugin v0.14.0 (minted cart token). Soft-check so
    // the spec documents the expectation without failing on the 0.8.1 deploy.
    if (row.cart_id == null) {
      test.info().annotations.push({
        type: "warning",
        description: "conversion landed without cart_id — deployed plugin predates v0.14.0",
      });
    }
  });
});
