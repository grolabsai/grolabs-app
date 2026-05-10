/**
 * Products pass of the WooCommerce import (v1).
 * Spec: docs/policy/wc-import.md §5 step 3.
 *
 * Page through GET /products?status=publish, upsert each on
 * (instance_id, woocommerce_id). After upsert, refresh
 * product_category_link rows from the WC categories[] array
 * (delete-then-insert — small per-product set).
 *
 * Variations are NOT exploded — the variations[] array (a list of
 * variation IDs returned by WC) is preserved in product.wc_raw and a
 * future wc-import-variants process restructures it.
 *
 * Slug collisions with non-WC rows retry once with a "-wc<id>" suffix.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listProductsPage, type WooClient } from "@/lib/sync/woocommerce-client";
import { mapProduct, type ProductWrite } from "./map";
import type { ImportError, ImportSummary, ImportProgress } from "./types";

type ProgressFn = (p: ImportProgress) => Promise<void> | void;

export async function pullProducts(
  supabase: SupabaseClient,
  wc: WooClient,
  instanceId: number,
  onProgress?: ProgressFn,
): Promise<ImportSummary> {
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const errors: ImportError[] = [];
  const renamedSlugs: ImportSummary["renamedSlugs"] = [];

  // Pre-fetch the category WC-id → Scout-id map once. We need it to
  // build product_category_link rows. Re-fetched per import run, not
  // cached across runs, so newly imported categories are visible.
  const categoryIdMap = await loadCategoryIdMap(supabase, instanceId);

  let page = 1;
  let total = 0;
  let upserted = 0;

  while (true) {
    const r = await listProductsPage(wc, page, 100, "publish");
    if (!r.ok) {
      errors.push({ message: `WC products page ${page}: ${r.error}` });
      break;
    }
    if (r.data.length === 0) break;

    for (const raw of r.data) {
      total += 1;
      const mapped = mapProduct(raw);

      try {
        const productId = await upsertProduct(supabase, instanceId, mapped, renamedSlugs);
        await refreshCategoryLinks(
          supabase,
          instanceId,
          productId,
          mapped.category_woocommerce_ids,
          categoryIdMap,
          mapped.woocommerce_id,
          errors,
        );
        await refreshProductMedia(
          supabase,
          instanceId,
          productId,
          mapped.images,
          mapped.woocommerce_id,
          errors,
        );
        // TODO: variant-level images. WC variations carry their own
        // .image field on each entry of row.variations[]. Today the
        // raw variations array is preserved on product.wc_raw (via
        // map.ts — `variations` is not in MAPPED_KEYS) but Scout does
        // not yet create product_variant rows from WC variations
        // (variant restructuring is deferred per docs/policy/wc-import.md).
        // When that lands, materialise one variant-scoped product_media
        // row per variation.image, keyed on the corresponding
        // product_variant.variant_id. Until then, parent-only media is
        // the correct shape — variant_id stays NULL on every WC-imported
        // media row, and the search/sync layers fall back to the parent
        // primary for each variant.
        upserted += 1;
      } catch (err) {
        errors.push({
          woocommerceId: mapped.woocommerce_id,
          identifier: mapped.product_name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (onProgress) {
      await onProgress({
        phase: "products",
        page,
        processed: total,
        upserted,
        failed: errors.filter((e) => e.woocommerceId !== undefined).length,
        startedAt,
      });
    }

    if (r.data.length < 100) break;
    page += 1;
  }

  return {
    total,
    upserted,
    failed: errors.filter((e) => e.woocommerceId !== undefined).length,
    durationMs: Date.now() - start,
    errors,
    renamedSlugs,
  };
}

async function loadCategoryIdMap(
  supabase: SupabaseClient,
  instanceId: number,
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("category")
    .select("category_id, woocommerce_id")
    .eq("instance_id", instanceId)
    .not("woocommerce_id", "is", null);

  if (error) return new Map();
  return new Map(
    (data ?? [])
      .filter((r) => r.woocommerce_id != null)
      .map((r) => [Number(r.woocommerce_id), Number(r.category_id)]),
  );
}

async function upsertProduct(
  supabase: SupabaseClient,
  instanceId: number,
  row: ProductWrite,
  renamedSlugs: ImportSummary["renamedSlugs"],
): Promise<number> {
  const baseSlug = row.slug;

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-wc${row.woocommerce_id}`;

    const { data, error } = await supabase
      .from("product")
      .upsert(
        {
          instance_id: instanceId,
          woocommerce_id: row.woocommerce_id,
          product_name: row.product_name,
          slug,
          short_description: row.short_description,
          long_description: row.long_description,
          image_url: row.image_url,
          sku: row.sku,
          price: row.price,
          sale_price: row.sale_price,
          stock_quantity: row.stock_quantity,
          barcode: row.barcode,
          cost: row.cost,
          wc_raw: row.wc_raw,
          is_active: true,
        },
        { onConflict: "instance_id,woocommerce_id" },
      )
      .select("product_id")
      .single();

    if (!error && data) {
      if (attempt === 1) {
        renamedSlugs.push({
          woocommerceId: row.woocommerce_id,
          from: baseSlug,
          to: slug,
        });
      }
      return Number(data.product_id);
    }

    const isSlugDupe =
      !!error && error.code === "23505" && /slug/i.test(error.message ?? "");
    if (!isSlugDupe || attempt === 1) {
      throw new Error(error?.message ?? "Unknown upsert error");
    }
  }
  throw new Error("Product upsert exhausted retry attempts");
}

async function refreshCategoryLinks(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  wcCategoryIds: number[],
  categoryIdMap: Map<number, number>,
  productWcId: number,
  errors: ImportError[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from("product_category_link")
    .delete()
    .eq("instance_id", instanceId)
    .eq("product_id", productId);

  if (delErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `clear category links: ${delErr.message}`,
    });
    return;
  }

  if (wcCategoryIds.length === 0) return;

  const rows = wcCategoryIds
    .map((wcCatId, idx) => {
      const catId = categoryIdMap.get(wcCatId);
      if (!catId) return null;
      return {
        instance_id: instanceId,
        product_id: productId,
        category_id: catId,
        is_primary: idx === 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    errors.push({
      woocommerceId: productWcId,
      message: `categories ${wcCategoryIds.join(",")} not found in Scout — run category import first`,
    });
    return;
  }

  const { error: insErr } = await supabase.from("product_category_link").insert(rows);
  if (insErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `insert category links: ${insErr.message}`,
    });
  }
}

/**
 * Reconcile product_media against the WC `images[]` array.
 *
 * - Delete any existing row whose image_url is not in the incoming set
 *   (handles WC-side image removal cleanly).
 * - For each incoming image, update an existing row matched by URL
 *   (preserves the media_id so Scout-side references stay stable), or
 *   insert a new one. is_primary is set on index 0 only; sort_order
 *   matches the WC ordering.
 *
 * Cross-row writes use the service-role client (the caller already
 * passes service-role into pullProducts) so RLS doesn't trip on the
 * delete branch.
 */
async function refreshProductMedia(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  images: Array<{ src: string; alt: string | null }>,
  productWcId: number,
  errors: ImportError[],
): Promise<void> {
  const incomingUrls = images.map((i) => i.src);

  const { data: existing, error: selErr } = await supabase
    .from("product_media")
    .select("media_id, image_url")
    .eq("instance_id", instanceId)
    .eq("product_id", productId);
  if (selErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `read product_media: ${selErr.message}`,
    });
    return;
  }

  const existingByUrl = new Map<string, number>(
    (existing ?? []).map((r) => [
      String((r as { image_url: string }).image_url),
      Number((r as { media_id: number }).media_id),
    ]),
  );

  const incomingSet = new Set(incomingUrls);
  const toDeleteIds = (existing ?? [])
    .filter((r) => !incomingSet.has(String((r as { image_url: string }).image_url)))
    .map((r) => Number((r as { media_id: number }).media_id));

  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("product_media")
      .delete()
      .in("media_id", toDeleteIds);
    if (delErr) {
      errors.push({
        woocommerceId: productWcId,
        message: `delete obsolete product_media: ${delErr.message}`,
      });
      return;
    }
  }

  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    const isPrimary = idx === 0;
    const existingId = existingByUrl.get(img.src);
    if (existingId !== undefined) {
      const { error: updErr } = await supabase
        .from("product_media")
        .update({
          is_primary: isPrimary,
          sort_order: idx,
          alt_text: img.alt,
        })
        .eq("media_id", existingId);
      if (updErr) {
        errors.push({
          woocommerceId: productWcId,
          message: `update product_media ${existingId}: ${updErr.message}`,
        });
      }
    } else {
      const { error: insErr } = await supabase.from("product_media").insert({
        instance_id: instanceId,
        product_id: productId,
        image_url: img.src,
        alt_text: img.alt,
        is_primary: isPrimary,
        sort_order: idx,
      });
      if (insErr) {
        errors.push({
          woocommerceId: productWcId,
          message: `insert product_media ${img.src}: ${insErr.message}`,
        });
      }
    }
  }
}
