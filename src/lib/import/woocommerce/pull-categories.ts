/**
 * Categories pass of the WooCommerce import (v1).
 * Spec: docs/policy/wc-import.md §5 step 2.
 *
 * Two-pass:
 *   1. Page through GET /products/categories, upsert each row with
 *      level=0 and parent_category_id=null. Idempotent on
 *      (instance_id, woocommerce_id).
 *   2. Re-walk the imported rows and set parent_category_id (looked up
 *      via woocommerce_id) and level (computed in-memory).
 *
 * Slug collisions with non-WC rows are handled by retrying the insert
 * with a "-wc<id>" suffix and recording the rename in the summary.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listProductCategoriesPage, type WooClient } from "@/lib/sync/woocommerce-client";
import {
  mapCategory,
  computeCategoryLevels,
  type CategoryWrite,
} from "./map";
import type {
  DebugReport,
  ImportError,
  ImportSummary,
  ImportProgress,
} from "./types";

type ProgressFn = (p: ImportProgress) => Promise<void> | void;

export async function pullCategories(
  supabase: SupabaseClient,
  wc: WooClient,
  instanceId: number,
  onProgress?: ProgressFn,
): Promise<ImportSummary> {
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const errors: ImportError[] = [];
  const renamedSlugs: ImportSummary["renamedSlugs"] = [];

  // Phase 1: collect & upsert flat (no parent)
  const allRows: CategoryWrite[] = [];
  let page = 1;
  let upserted = 0;

  while (true) {
    const r = await listProductCategoriesPage(wc, page, 100);
    if (!r.ok) {
      errors.push({ message: `WC categories page ${page}: ${r.error}` });
      break;
    }
    if (r.data.length === 0) break;

    for (const raw of r.data) {
      const mapped = mapCategory(raw);
      allRows.push(mapped);

      try {
        const renamedTo = await upsertCategoryFlat(supabase, instanceId, mapped);
        if (renamedTo) {
          renamedSlugs.push({
            woocommerceId: mapped.woocommerce_id,
            from: mapped.slug,
            to: renamedTo,
          });
          mapped.slug = renamedTo;
        }
        upserted += 1;
      } catch (err) {
        errors.push({
          woocommerceId: mapped.woocommerce_id,
          identifier: mapped.category_name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (onProgress) {
      await onProgress({
        phase: "categories",
        page,
        processed: allRows.length,
        upserted,
        failed: errors.filter((e) => e.woocommerceId !== undefined).length,
        startedAt,
      });
    }

    if (r.data.length < 100) break;
    page += 1;
  }

  // Phase 2: resolve parent_category_id + level
  if (allRows.length > 0) {
    const wcIds = allRows.map((r) => r.woocommerce_id);
    const { data: rreRows, error: lookupErr } = await supabase
      .from("category")
      .select("category_id, woocommerce_id")
      .eq("instance_id", instanceId)
      .in("woocommerce_id", wcIds);

    if (lookupErr) {
      errors.push({ message: `Parent lookup failed: ${lookupErr.message}` });
    } else {
      const rreIdByWcId = new Map<number, number>(
        (rreRows ?? []).map((r) => [Number(r.woocommerce_id), Number(r.category_id)]),
      );
      const levels = computeCategoryLevels(allRows);

      for (const row of allRows) {
        const rreId = rreIdByWcId.get(row.woocommerce_id);
        if (!rreId) continue;
        const parentRreId =
          row.parent_woocommerce_id != null
            ? (rreIdByWcId.get(row.parent_woocommerce_id) ?? null)
            : null;
        const level = levels.get(row.woocommerce_id) ?? 0;

        const { error: updErr } = await supabase
          .from("category")
          .update({
            parent_category_id: parentRreId,
            level,
          })
          .eq("instance_id", instanceId)
          .eq("category_id", rreId);

        if (updErr) {
          errors.push({
            woocommerceId: row.woocommerce_id,
            identifier: row.category_name,
            message: `parent/level update: ${updErr.message}`,
          });
        }
      }
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - start;
  const debug: DebugReport = {
    phase: "categories",
    startedAt,
    completedAt,
    durationMs,
    totals: {
      productsProcessed: 0,
      productsUpserted: 0,
      productsFailed: 0,
      productsRenamed: renamedSlugs.length,
      categoriesUpserted: upserted,
      variantsUpserted: 0,
      pricingRowsUpserted: 0,
      tagsUpserted: 0,
      tagLinksWritten: 0,
      attributesUpserted: 0,
      attributeOptionsUpserted: 0,
      variantAttributeRowsUpserted: 0,
      categoryAxisFlips: 0,
    },
    perProduct: [],
  };

  return {
    total: allRows.length,
    upserted,
    failed: errors.filter((e) => e.woocommerceId !== undefined).length,
    durationMs,
    errors,
    renamedSlugs,
    debug,
  };
}

/**
 * Upsert a single category by (instance_id, woocommerce_id).
 * Returns null on plain success, or the renamed slug if we had to suffix.
 *
 * Re-imports update the existing row by woocommerce_id, so slug
 * collisions only happen on first import against a pre-existing
 * (non-WC) seeded row that already owns the slug.
 */
async function upsertCategoryFlat(
  supabase: SupabaseClient,
  instanceId: number,
  row: CategoryWrite,
): Promise<string | null> {
  const baseSlug = row.slug;

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-wc${row.woocommerce_id}`;

    const { error } = await supabase.from("category").upsert(
      {
        instance_id: instanceId,
        woocommerce_id: row.woocommerce_id,
        category_name: row.category_name,
        slug,
        description: row.description,
        // parent_category_id + level get set in pass 2.
        // level must satisfy the (1,2) CHECK — start as 1 (root), pass
        // 2 corrects to 2 if a parent is found.
        level: 1,
        parent_category_id: null,
        is_active: true,
      },
      { onConflict: "instance_id,woocommerce_id" },
    );

    if (!error) return attempt === 0 ? null : slug;

    // 23505 = unique_violation. If it's the slug constraint, retry
    // with the suffixed slug; otherwise rethrow.
    const isSlugDupe =
      error.code === "23505" && /slug/i.test(error.message ?? "");
    if (!isSlugDupe || attempt === 1) {
      throw new Error(error.message);
    }
  }
  return null;
}
