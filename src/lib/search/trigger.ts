/**
 * Server-action friendly wrapper around the Meilisearch indexer.
 *
 * Per docs/policy/search-foundations.md §9. The indexing pipeline is
 * synchronous from the user's mutation, but it must never propagate failures
 * back to the user — a Meilisearch outage should not block a product save.
 * This helper:
 *   - awaits the indexer so errors are observable in logs / sync_status
 *   - swallows exceptions and connection issues (already recorded in
 *     `failed_indexing` by the indexer's own error path)
 *   - no-ops when MEILISEARCH_HOST or MEILISEARCH_MASTER_KEY are absent,
 *     so local dev without search credentials still works.
 *
 * Stage 1.5+ will queue these via Vercel cron once the search index is in
 * the user-visible critical path; for now the latency is fine — Wazú has
 * tens of products.
 */

import { indexProduct, removeProduct, type IndexResult } from "./indexer";

function meilisearchEnabled(): boolean {
  return !!(process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_MASTER_KEY);
}

export async function triggerProductIndex(
  instanceId: number,
  productId: number
): Promise<IndexResult | null> {
  if (!meilisearchEnabled()) return null;
  try {
    return await indexProduct(instanceId, productId);
  } catch (err) {
    console.error(
      `[search/trigger] indexProduct(${instanceId}, ${productId}) failed:`,
      err instanceof Error ? err.message : err
    );
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function triggerProductRemove(
  instanceId: number,
  productId: number
): Promise<IndexResult | null> {
  if (!meilisearchEnabled()) return null;
  try {
    return await removeProduct(instanceId, productId);
  } catch (err) {
    console.error(
      `[search/trigger] removeProduct(${instanceId}, ${productId}) failed:`,
      err instanceof Error ? err.message : err
    );
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
