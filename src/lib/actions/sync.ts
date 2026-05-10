"use server";

import { revalidatePath } from "next/cache";

import {
  deleteObjects as algoliaDeleteObjects,
  saveObjects as algoliaSaveObjects,
} from "@/lib/sync/algolia-client";
import {
  mapProductToAlgoliaRecords,
  type AlgoliaSourceProduct,
} from "@/lib/sync/algolia-mapping";
import {
  batchVariations,
  createProduct as wcCreateProduct,
  findProductBySku,
  updateProduct as wcUpdateProduct,
  verifyWooConnection,
  type WooClient,
} from "@/lib/sync/woocommerce-client";
import { mapProductToWooCommerce } from "@/lib/sync/woocommerce-mapping";
import { syncCategoryTreeToWoocommerce } from "@/lib/sync/woocommerce-categories";
import { currentInstanceId } from "@/lib/instance";
import { createClient } from "@/lib/supabase/server";

// ─── Result shape ──────────────────────────────────────────────────────────

export type SyncRunResult =
  | {
      ok: true;
      platform: "algolia" | "woocommerce";
      productsCount: number;
      succeededCount: number;
      failedCount: number;
      logId: number;
    }
  | { error: string };

// ─── Helpers ───────────────────────────────────────────────────────────────

async function startSyncLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instanceId: number,
  platform: "algolia" | "woocommerce",
  productsCount: number,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("sync_log")
    .insert({
      instance_id: instanceId,
      platform,
      products_count: productsCount,
      status: "running",
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: number }).id;
}

async function endSyncLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logId: number,
  status: "success" | "partial" | "error",
  succeeded: number,
  failed: number,
  errorMessage: string | null,
): Promise<void> {
  await supabase
    .from("sync_log")
    .update({
      ended_at: new Date().toISOString(),
      succeeded_count: succeeded,
      failed_count: failed,
      status,
      error_message: errorMessage,
    })
    .eq("id", logId);
}

async function upsertSyncStatuses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instanceId: number,
  platform: "algolia" | "woocommerce",
  productResults: Array<{
    productId: number;
    success: boolean;
    error?: string | null;
    externalId?: string | null;
  }>,
  syncedAt: Date,
): Promise<void> {
  if (productResults.length === 0) return;
  const rows = productResults.map((r) => ({
    instance_id: instanceId,
    product_id: r.productId,
    platform,
    last_synced_at: r.success ? syncedAt.toISOString() : undefined,
    last_status: r.success ? "success" : "error",
    last_error: r.success ? null : r.error ?? "Unknown error",
    external_id: r.externalId ?? undefined,
  }));
  // Upsert by (instance_id, product_id, platform)
  await supabase
    .from("product_sync_status")
    .upsert(rows, { onConflict: "instance_id,product_id,platform" });
}

// ─── Algolia push ──────────────────────────────────────────────────────────

/**
 * Push the selected products to the instance's configured Algolia index.
 *
 *   1. Resolve the index name + admin key from instance.integrations_config
 *      (admin key via the Vault RPC).
 *   2. Fetch product + variant + pricing + media + brand + categories
 *      for the selected ids.
 *   3. Project to Algolia records (one per variant with a SKU).
 *   4. saveObjects in batches.
 *   5. Update product_sync_status per product, write sync_log.
 */
export async function syncProductsToAlgolia(
  productIds: number[],
): Promise<SyncRunResult> {
  if (productIds.length === 0) return { error: "No products selected." };

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();

  // ── Load Algolia config + admin key from Vault ─────────────────────────────
  const { data: instanceRow, error: instErr } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (instErr) return { error: instErr.message };
  type AlgoliaCfg = { app_id?: string; primary_index?: string };
  const algoliaCfg: AlgoliaCfg =
    ((instanceRow?.integrations_config as { algolia?: AlgoliaCfg })?.algolia) ?? {};
  if (!algoliaCfg.app_id || !algoliaCfg.primary_index) {
    return {
      error:
        "Algolia is not configured for this instance. Set app id and primary index in /configuration/algolia.",
    };
  }
  const { data: adminKey, error: keyErr } = await supabase.rpc("algolia_get_admin_key", {
    p_instance_id: instanceId,
  });
  if (keyErr || !adminKey) {
    return { error: keyErr?.message ?? "No Algolia admin key on file." };
  }

  // ── Open the sync log row ──────────────────────────────────────────────────
  const logId = await startSyncLog(supabase, instanceId, "algolia", productIds.length);

  // ── Fetch products with everything we need to project ──────────────────────
  const { data: rows, error: pErr } = await supabase
    .from("product")
    .select(
      `product_id, product_name, slug, short_description, long_description, is_active, image_url,
       brand:brand_id ( brand_name ),
       product_category_link ( is_primary, category_id, category:category_id ( category_name, slug ) ),
       product_media ( image_url, is_primary, sort_order ),
       product_variant (
         variant_id, variant_name, sku, barcode, weight_grams, is_active,
         product_pricing ( list_price, cost_price, channel, currency )
       )`,
    )
    .in("product_id", productIds)
    .returns<AlgoliaSourceProduct[]>();
  if (pErr) {
    if (logId) await endSyncLog(supabase, logId, "error", 0, productIds.length, pErr.message);
    return { error: pErr.message };
  }
  const products = rows ?? [];

  // ── Project + push ─────────────────────────────────────────────────────────
  // We track success per-product, not per-variant. A product is "synced"
  // when ALL of its variants pushed successfully.
  const perProduct: Array<{
    productId: number;
    recordCount: number;
    pushed: number;
  }> = [];
  let allRecords: ReturnType<typeof mapProductToAlgoliaRecords> = [];
  const recordToProductId = new Map<string, number>();
  for (const p of products) {
    const records = mapProductToAlgoliaRecords(p);
    perProduct.push({ productId: p.product_id, recordCount: records.length, pushed: 0 });
    for (const r of records) {
      recordToProductId.set(r.objectID, p.product_id);
      allRecords = allRecords.concat(r);
    }
  }

  if (allRecords.length === 0) {
    // Every selected product had no variants with SKUs.
    if (logId) await endSyncLog(supabase, logId, "error", 0, productIds.length, "No variants with SKU.");
    return {
      error:
        "Ningún producto seleccionado tiene variantes con SKU. Algolia rechaza registros sin objectID.",
    };
  }

  const batchResult = await algoliaSaveObjects(
    { appId: algoliaCfg.app_id, adminKey: adminKey as string },
    algoliaCfg.primary_index,
    allRecords,
  );

  // The Algolia client batches internally; we don't get per-record success
  // signals back. So in practice: if firstError is set, we mark every
  // product as failed; if not, all succeed.
  const overallSuccess = batchResult.failed === 0;
  const syncedAt = new Date();
  const productResults = perProduct.map((p) => ({
    productId: p.productId,
    success: overallSuccess,
    error: overallSuccess ? null : batchResult.firstError,
  }));

  await upsertSyncStatuses(supabase, instanceId, "algolia", productResults, syncedAt);

  // ── Close the sync log ─────────────────────────────────────────────────────
  if (logId) {
    const status = overallSuccess ? "success" : batchResult.ok > 0 ? "partial" : "error";
    await endSyncLog(
      supabase,
      logId,
      status,
      productResults.filter((r) => r.success).length,
      productResults.filter((r) => !r.success).length,
      batchResult.firstError ?? null,
    );
  }

  // ── Invalidate UI ──────────────────────────────────────────────────────────
  revalidatePath("/sync");
  revalidatePath("/catalog/products");

  return {
    ok: true,
    platform: "algolia",
    productsCount: productIds.length,
    succeededCount: productResults.filter((r) => r.success).length,
    failedCount: productResults.filter((r) => !r.success).length,
    logId: logId ?? 0,
  };
}

// ─── WooCommerce push ──────────────────────────────────────────────────────

type WooConfig = {
  site_url?: string;
  consumer_key?: string;
};

async function loadWooClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instanceId: number,
): Promise<{ ok: true; client: WooClient } | { error: string }> {
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  const cfg: WooConfig =
    ((instanceRow?.integrations_config as { woocommerce?: WooConfig })?.woocommerce) ?? {};
  if (!cfg.site_url || !cfg.consumer_key) {
    return {
      error:
        "WooCommerce no está configurado para esta instancia. Completa /configuration/woocommerce.",
    };
  }
  const { data: secret, error: secErr } = await supabase.rpc(
    "woocommerce_get_consumer_secret",
    { p_instance_id: instanceId },
  );
  if (secErr || !secret) {
    return { error: secErr?.message ?? "No hay consumer secret en Vault." };
  }
  return {
    ok: true,
    client: {
      siteUrl: cfg.site_url,
      consumerKey: cfg.consumer_key,
      consumerSecret: secret as string,
    },
  };
}

/**
 * Verify a WooCommerce connection and record the result. Used by the
 * "Test connection" button on /configuration/woocommerce.
 */
export async function verifyWooCommerceConnection(): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
}> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    return { ok: false, status: 0, latencyMs: 0, message: "No instance" };
  }
  const supabase = await createClient();
  const loaded = await loadWooClient(supabase, instanceId);
  if (!("ok" in loaded)) {
    return { ok: false, status: 0, latencyMs: 0, message: loaded.error };
  }
  const r = await verifyWooConnection(loaded.client);
  await supabase.rpc("woocommerce_record_verification", {
    p_instance_id: instanceId,
    p_http_status: r.status,
    p_latency_ms: r.latencyMs,
  });
  revalidatePath("/configuration/woocommerce");
  return r;
}

/**
 * Push the selected products to WooCommerce.
 *
 *   1. Resolve creds + URL.
 *   2. For each product: look up by parent SKU (we use product.slug as a
 *      stable key). If not found, create. Otherwise update.
 *   3. Batch its variations under the parent.
 *   4. Cache the WC parent id in product_sync_status.external_id so the
 *      next push skips the SKU lookup.
 *   5. Update product_sync_status + sync_log per product.
 */
export async function syncProductsToWordPress(
  productIds: number[],
): Promise<SyncRunResult> {
  if (productIds.length === 0) return { error: "No products selected." };
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();

  const loaded = await loadWooClient(supabase, instanceId);
  if (!("ok" in loaded)) return { error: loaded.error };
  const wc = loaded.client;

  const logId = await startSyncLog(supabase, instanceId, "woocommerce", productIds.length);

  // Fetch the products with everything we need to project
  const { data: rows, error: pErr } = await supabase
    .from("product")
    .select(
      `product_id, product_name, slug, short_description, long_description, is_active, image_url,
       brand:brand_id ( brand_name ),
       product_category_link ( is_primary, category_id, category:category_id ( category_name, slug ) ),
       product_media ( image_url, is_primary, sort_order ),
       product_variant (
         variant_id, variant_name, sku, barcode, weight_grams, is_active,
         product_pricing ( list_price, cost_price, channel, currency )
       )`,
    )
    .in("product_id", productIds)
    .returns<AlgoliaSourceProduct[]>();
  if (pErr) {
    if (logId) await endSyncLog(supabase, logId, "error", 0, productIds.length, pErr.message);
    return { error: pErr.message };
  }
  const products = rows ?? [];

  // ── Pre-sync the category tree ────────────────────────────────────────────
  // WC's REST API requires categories: [{ id }] on products. Sending name
  // alone is silently ignored — that's why products were landing with no
  // categories assigned. Build (or refresh) the Scout→WC category id map
  // before pushing products so each product can carry the right ids.
  const distinctCategoryIds = new Set<number>();
  for (const p of products) {
    for (const link of p.product_category_link ?? []) {
      if (typeof link.category_id === "number") {
        distinctCategoryIds.add(link.category_id);
      }
    }
  }
  const categorySync = await syncCategoryTreeToWoocommerce(
    supabase,
    wc,
    instanceId,
    Array.from(distinctCategoryIds),
  );
  const failedCategoryIds = new Set(
    categorySync.failures.map((f) => f.categoryId),
  );

  // Pre-fetch cached external ids so we can update-by-id when possible
  const { data: existingStatuses } = await supabase
    .from("product_sync_status")
    .select("product_id, external_id")
    .eq("instance_id", instanceId)
    .eq("platform", "woocommerce")
    .in("product_id", productIds);
  const externalIdByProduct = new Map<number, string | null>();
  for (const r of existingStatuses ?? []) {
    externalIdByProduct.set(
      (r as { product_id: number; external_id: string | null }).product_id,
      (r as { product_id: number; external_id: string | null }).external_id,
    );
  }

  const productResults: Array<{
    productId: number;
    success: boolean;
    error?: string | null;
    externalId?: string | null;
  }> = [];

  for (const p of products) {
    const projection = mapProductToWooCommerce(p, {
      categoryIdByScoutId: categorySync.idMap,
    });
    if (projection.variations.length === 0) {
      productResults.push({
        productId: p.product_id,
        success: false,
        error: "No hay variantes con SKU; WooCommerce las requiere.",
      });
      continue;
    }
    // Surface category-sync misses as a soft warning. We still push the
    // product (with whatever categories did resolve) — better to have a
    // partially-categorised product than to block the push entirely.
    const productMissedCategories = (p.product_category_link ?? [])
      .map((l) => l.category_id)
      .filter((cid): cid is number => typeof cid === "number")
      .filter((cid) => failedCategoryIds.has(cid));
    if (productMissedCategories.length > 0) {
      const failureLookup = new Map(
        categorySync.failures.map((f) => [f.categoryId, f.error]),
      );
      const errs = productMissedCategories
        .map((cid) => `${cid}:${failureLookup.get(cid) ?? "unknown"}`)
        .join(", ");
      // Log to the server console for support; the product still pushes.
      console.warn(
        `[woo-sync] product ${p.product_id} has unresolved categories — ${errs}`,
      );
    }

    let parentId: number | null = null;
    const cachedId = externalIdByProduct.get(p.product_id);
    if (cachedId) parentId = Number(cachedId);

    // If we have no cached id, find by SKU of the first variant. Scout's
    // product slug isn't guaranteed unique on the WC side, so we use the
    // first variant SKU as the identification key (also unique in WC).
    if (parentId === null) {
      const lookupSku = projection.variations[0].sku ?? null;
      if (lookupSku) {
        const lookup = await findProductBySku(wc, lookupSku);
        if (!lookup.ok) {
          productResults.push({
            productId: p.product_id,
            success: false,
            error: lookup.error,
          });
          continue;
        }
        parentId = lookup.product?.id ?? null;
      }
    }

    if (parentId === null) {
      // Create
      const created = await wcCreateProduct(wc, projection.parent);
      if (!created.ok) {
        productResults.push({
          productId: p.product_id,
          success: false,
          error: created.error,
        });
        continue;
      }
      parentId = created.data.id;
    } else {
      // Update — try id first; on 404 (cache stale) fall back to create.
      const updated = await wcUpdateProduct(wc, parentId, projection.parent);
      if (!updated.ok) {
        if (updated.status === 404) {
          // Cache was stale (product deleted out-of-band). Re-create.
          const created = await wcCreateProduct(wc, projection.parent);
          if (!created.ok) {
            productResults.push({
              productId: p.product_id,
              success: false,
              error: created.error,
            });
            continue;
          }
          parentId = created.data.id;
        } else {
          productResults.push({
            productId: p.product_id,
            success: false,
            error: updated.error,
          });
          continue;
        }
      }
    }

    // Variations: try create; rely on WC's idempotency-by-SKU. If a
    // variation with that SKU already exists under the parent, WC
    // updates it; otherwise creates. WC v3 treats POST to variations as
    // create-or-update when SKU exists.
    const batchRes = await batchVariations(wc, parentId, {
      create: projection.variations,
    });
    if (!batchRes.ok) {
      productResults.push({
        productId: p.product_id,
        success: false,
        error: batchRes.error,
        externalId: parentId.toString(),
      });
      continue;
    }

    productResults.push({
      productId: p.product_id,
      success: true,
      externalId: parentId.toString(),
    });
  }

  const syncedAt = new Date();
  await upsertSyncStatuses(supabase, instanceId, "woocommerce", productResults, syncedAt);

  const succeededCount = productResults.filter((r) => r.success).length;
  const failedCount = productResults.filter((r) => !r.success).length;
  const overallStatus =
    failedCount === 0 ? "success" : succeededCount === 0 ? "error" : "partial";

  if (logId) {
    const firstError = productResults.find((r) => !r.success)?.error ?? null;
    await endSyncLog(supabase, logId, overallStatus, succeededCount, failedCount, firstError);
  }

  revalidatePath("/sync");
  revalidatePath("/catalog/products");

  return {
    ok: true,
    platform: "woocommerce",
    productsCount: productIds.length,
    succeededCount,
    failedCount,
    logId: logId ?? 0,
  };
}

// ─── Algolia delete (used when products are deleted in Scout) ──────────────

/**
 * Remove products from Algolia by SKU. Used when products are deleted in
 * Scout — call from the deleteProduct path. (Not yet wired; leaving the
 * function here so future hookup is mechanical.)
 */
export async function removeProductsFromAlgolia(
  variantSkus: string[],
): Promise<SyncRunResult> {
  if (variantSkus.length === 0) return { error: "No SKUs supplied." };
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  type AlgoliaCfg = { app_id?: string; primary_index?: string };
  const algoliaCfg: AlgoliaCfg =
    ((instanceRow?.integrations_config as { algolia?: AlgoliaCfg })?.algolia) ?? {};
  if (!algoliaCfg.app_id || !algoliaCfg.primary_index) {
    return { error: "Algolia is not configured." };
  }
  const { data: adminKey } = await supabase.rpc("algolia_get_admin_key", {
    p_instance_id: instanceId,
  });
  if (!adminKey) return { error: "No Algolia admin key on file." };

  const r = await algoliaDeleteObjects(
    { appId: algoliaCfg.app_id, adminKey: adminKey as string },
    algoliaCfg.primary_index,
    variantSkus,
  );
  return {
    ok: true,
    platform: "algolia",
    productsCount: variantSkus.length,
    succeededCount: r.ok,
    failedCount: r.failed,
    logId: 0,
  };
}
