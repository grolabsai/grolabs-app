/**
 * Setup / teardown helpers for the search integration suite.
 *
 * Setup:
 *   1. Verifies required env vars are set; otherwise throws with a clear
 *      message so vitest reports "missing env" instead of an obscure CORS
 *      or 500 error from the route handler.
 *   2. Calls ensureIndex(TEST_INSTANCE_ID) so the test index exists and
 *      carries the standard filterableAttributes (`category_ids`,
 *      `instance_id`, etc. — same settings prod uses).
 *   3. Wipes any leftover documents from a previous run, then uploads the
 *      synthetic FIXTURES and waits until Meilisearch finishes indexing.
 *
 * Teardown:
 *   - Deletes the entire test index. Cheap and ensures the next run starts
 *     from zero. The Supabase test-instance row is permanent (per migration
 *     20260520000001) so it persists across runs.
 *
 * Both functions are idempotent. Callers can re-invoke setupSearchFixtures()
 * safely; the index gets recreated from scratch each time.
 */

import {
  deleteAllDocuments,
  deleteIndex,
  ensureIndex,
  upsertDocuments,
  waitForTaskCompletion,
} from "@/lib/search/meilisearch-client";
import { FIXTURES, TEST_INSTANCE_ID } from "./fixtures";

const REQUIRED_ENV = [
  "MEILISEARCH_HOST",
  "MEILISEARCH_MASTER_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function assertEnvOrSkip(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Integration tests require: ${REQUIRED_ENV.join(", ")}. Missing: ${missing.join(", ")}. ` +
        `Set them in .env.local (locally) or as GitHub Actions secrets (CI).`,
    );
  }
}

export async function setupSearchFixtures(): Promise<void> {
  assertEnvOrSkip();

  // Idempotent index creation. Picks up DEFAULT_INDEX_SETTINGS — including
  // filterableAttributes that the tests depend on for category filters.
  await ensureIndex(TEST_INSTANCE_ID);

  // Wipe any leftovers from a previous run, then re-upload. We could also
  // simply delete-and-recreate the index every time, but that's slower
  // because Meilisearch re-runs the full settings apply.
  const wipe = await deleteAllDocuments(TEST_INSTANCE_ID);
  if (wipe.taskUid >= 0) {
    await waitForTaskCompletion(wipe.taskUid);
  }

  const seed = await upsertDocuments(TEST_INSTANCE_ID, FIXTURES);
  if (seed.taskUid >= 0) {
    await waitForTaskCompletion(seed.taskUid);
  }
}

export async function teardownSearchFixtures(): Promise<void> {
  // Don't gate on env vars — if setup never ran, the index won't exist and
  // deleteIndex() is a no-op (404 → swallowed).
  await deleteIndex(TEST_INSTANCE_ID);
}
