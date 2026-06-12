import { test as setup } from "@playwright/test";
import { login } from "./helpers";

const APP_URL = process.env.APP_URL || "https://app.grolabs.ai";

setup("authenticate (RRE app host)", async ({ page }) => {
  await login(page, APP_URL);
  await page.context().storageState({ path: "playwright/.auth/app.json" });
});
