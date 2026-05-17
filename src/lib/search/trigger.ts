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

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { indexProduct, removeProduct, type IndexResult } from "./indexer";

function meilisearchEnabled(): boolean {
  return !!(process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_MASTER_KEY);
}

/** Read just product.woocommerce_id. The GroLabs→WC round-trip is the gate
 * for indexing: a doc with no parent WC ID can't be added to the cart by
 * the storefront plugin, so there's no point indexing it. Once the WC push
 * captures and writes back the id, the next index trigger will succeed. */
async function getProductWoocommerceId(
  instanceId: number,
  productId: number
): Promise<number | null | "missing"> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("product")
    .select("woocommerce_id")
    .eq("instance_id", instanceId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error || !data) return "missing";
  const wcId = (data as { woocommerce_id: number | null }).woocommerce_id;
  return wcId ?? null;
}

export async function triggerProductIndex(
  instanceId: number,
  productId: number
): Promise<IndexResult | null> {
  if (!meilisearchEnabled()) return null;
  try {
    const wcId = await getProductWoocommerceId(instanceId, productId);
    if (wcId === "missing") {
      // Product not found — make sure the index doesn't carry a stale doc.
      return await removeProduct(instanceId, productId);
    }
    if (wcId === null) {
      // Not yet round-tripped to WC. Skip indexing AND clear any stale doc
      // a previous round-trip might have left behind. Debug-level log: this
      // is normal for freshly-created GroLabs products.
      console.debug(
        `[search/trigger] skip index ${instanceId}/${productId} — woocommerce_id is null`
      );
      return await removeProduct(instanceId, productId);
    }
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
