import { test } from "@playwright/test";
import { ADMIN_PATHS, assertHealthy } from "./helpers";

for (const path of ADMIN_PATHS) {
  test(`admin ${path} renders without crashing`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(path, { waitUntil: "domcontentloaded" });
    await assertHealthy(page, path);

    // The locale error boundary logs `[locale-error-boundary]` when a render
    // throws — that's the exact signature of the AgentPanelProvider crash.
    const boundary = errors.find((t) => t.includes("locale-error-boundary"));
    if (boundary) throw new Error(`Render error on ${path}: ${boundary}`);
  });
}
