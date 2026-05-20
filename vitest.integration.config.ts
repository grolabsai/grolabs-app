import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration config. Picked up by `npm run test:integration`. Runs the
 * suite under tests/integration/** which expects MEILISEARCH_HOST,
 * MEILISEARCH_MASTER_KEY, NEXT_PUBLIC_SUPABASE_URL, and
 * SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 * Longer testTimeout because Meilisearch's indexing is async — the fixture
 * seeder polls until the task succeeds, which can take a few seconds on a
 * cold index.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests share a Meilisearch index — they can't run in
    // parallel without colliding. Single-file mode keeps it safe.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
