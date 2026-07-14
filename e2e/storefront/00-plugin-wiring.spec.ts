import { test, expect } from "@playwright/test";
import { TEST_INSTANCE_ID } from "../lib/db";
import { dismissPopups, pluginEventsConfig, tagged } from "../lib/run";

/**
 * Preflight gate for the whole storefront tier.
 *
 * Every journey spec assumes the grolabs-wordpress-search plugin on the live
 * site points at the TEST instance. If it points anywhere else the storefront
 * silently writes nothing (origin validation 403s) and every downstream spec
 * would fail with confusing timeouts — so fail HERE, with the fix in the
 * message.
 *
 * Known state 2026-07-12: the deployed plugin was configured for instance 10
 * (a deleted Wazú instance) and pinned at 0.8.1. Fix in wp-admin:
 * Settings → GroLabs Search → instance ID = 12, and update the plugin zip.
 */
test.describe("storefront plugin wiring", () => {
  test("events config points at the test instance", async ({ page }) => {
    await page.goto(tagged("/"));

    const cfg = await pluginEventsConfig(page);
    expect(
      cfg,
      "GrolabsWordPressSearchEvents missing — is grolabs-wordpress-search active on the site?",
    ).not.toBeNull();

    expect(
      Number(cfg!.instanceId),
      `plugin is configured for instance ${cfg!.instanceId} — set wp-admin → Settings → GroLabs Search → instance ID to ${TEST_INSTANCE_ID}`,
    ).toBe(TEST_INSTANCE_ID);

    expect(cfg!.apiHost, "events must flow to the production API host").toContain(
      "app.grolabs.ai",
    );
  });

  test("browser id cookie is minted", async ({ page, context }) => {
    await page.goto(tagged("/"));
    await dismissPopups(page);
    // events.js (v0.14.0+) mints grolabs_bid at load; older deploys only mint
    // it when the typeahead first fires — poke the search box so both pass.
    const input = page.locator('form[role="search"] input[name="s"]').first();
    if (await input.isVisible().catch(() => false)) {
      await input.click();
      await input.pressSequentially("do", { delay: 150 });
    }
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === "grolabs_bid"), {
        message:
          "grolabs_bid cookie never appeared — plugin JS not executing, or the deployed plugin predates v0.10.0 (the cookie identity path). Update grolabs-wordpress-search to the latest release zip.",
      })
      .toBe(true);
  });
});
