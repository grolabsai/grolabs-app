import { test as setup } from "@playwright/test";
import { login } from "./helpers";

const ADMIN_URL = process.env.ADMIN_URL || "https://admin.grolabs.ai";

setup("authenticate (admin host)", async ({ page }) => {
  await login(page, ADMIN_URL);
  await page.context().storageState({ path: "playwright/.auth/admin.json" });
});
