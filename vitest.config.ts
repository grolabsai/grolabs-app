import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Two test modes:
 *
 *   - "unit"        — fast, no IO. Runs by default (`npm test`).
 *   - "integration" — talks to a real Meilisearch cluster + Supabase project.
 *                     Opt-in via `npm run test:integration`. Gated on
 *                     MEILISEARCH_HOST + MEILISEARCH_MASTER_KEY +
 *                     SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars; if
 *                     any are missing the suite skips with a clear message
 *                     rather than failing.
 *
 * Integration tests live alongside unit tests under tests/integration/**.
 * The mode is selected by the include glob, not by a runtime flag.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    testTimeout: 10_000,
    setupFiles: ["tests/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
