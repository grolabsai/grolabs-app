/**
 * Sync the GroLabs category tree to WooCommerce ahead of a product push.
 *
 * Why:
 *   WC's REST API expects products with categories: [{ id }] — name-only
 *   entries are silently ignored, so products land with no categories
 *   assigned. Before pushing products we therefore need a GroLabs category_id
 *   → WC category id mapping. This module owns that mapping.
 *
 * How:
 *   1. Caller passes the GroLabs category ids touched by the push (the
 *      categories of all products being synced).
 *   2. We expand the set with every ancestor up to the root — WC requires
 *      a category's parent to exist before the child can be created.
 *   3. We walk root → leaf:
 *        - If we already have external_id cached in category_sync_status,
 *          use it.
 *        - Else look up by slug on WC (slugs are unique per parent in WC,
 *          but we treat them as unique across the site; if a category
 *          with a given slug exists at a different position in the tree
 *          we adopt it and let the user reconcile in WC if needed).
 *        - Else create with parent's already-resolved WC id.
 *      Cache external_id back into category_sync_status.
 *
 * Returns a Map<scoutCategoryId, wcCategoryId> for every category that
 * was successfully synced, plus a list of categories that failed (so the
 * caller can surface a per-product warning when a product references one
 * of them).
 */

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createCategory as wcCreateCategory,
  listCategories as wcListCategories,
  type WooClient,
} from "@/lib/sync/woocommerce-client";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type CategoryRow = {
  category_id: number;
  parent_category_id: number | null;
  category_name: string;
  slug: string;
};

type SyncStatusRow = {
  category_id: number;
  external_id: string | null;
};

export type CategorySyncFailure = {
  categoryId: number;
  error: string;
};

export type CategorySyncResult = {
  /** GroLabs category_id → WC category id, for every category that resolved. */
  idMap: Map<number, number>;
  /** Categories we tried but couldn't sync. Caller should surface as warnings. */
  failures: CategorySyncFailure[];
};

export async function syncCategoryTreeToWoocommerce(
  supabase: SupabaseServerClient,
  wc: WooClient,
  instanceId: number,
  scoutCategoryIds: number[],
): Promise<CategorySyncResult> {
  const idMap = new Map<number, number>();
  const failures: CategorySyncFailure[] = [];

  if (scoutCategoryIds.length === 0) return { idMap, failures };

  // ── 1. Load the entire category tree for the instance ────────────────────
  // We need ancestors for any input id, and the easiest way is to grab the
  // full tree once. Catalogs are typically <1k rows — cheap.
  const { data: catRows, error: catErr } = await supabase
    .from("category")
    .select("category_id, parent_category_id, category_name, slug")
    .eq("instance_id", instanceId)
    .returns<CategoryRow[]>();
  if (catErr) {
    return {
      idMap,
      failures: scoutCategoryIds.map((cid) => ({
        categoryId: cid,
        error: catErr.message,
      })),
    };
  }
  const allCats = catRows ?? [];
  const byId = new Map<number, CategoryRow>();
  for (const c of allCats) byId.set(c.category_id, c);

  // ── 2. Expand input set with all ancestors ───────────────────────────────
  const needed = new Set<number>();
  for (const cid of scoutCategoryIds) {
    let cursor: number | null = cid;
    while (cursor !== null && !needed.has(cursor)) {
      const row = byId.get(cursor);
      if (!row) break; // Orphan reference; skip.
      needed.add(cursor);
      cursor = row.parent_category_id;
    }
  }

  // ── 3. Pull cached external_ids for the needed set ───────────────────────
  const neededArr = Array.from(needed);
  const { data: cached } = await supabase
    .from("category_sync_status")
    .select("category_id, external_id")
    .eq("instance_id", instanceId)
    .eq("platform", "woocommerce")
    .in("category_id", neededArr)
    .returns<SyncStatusRow[]>();
  const cachedById = new Map<number, string | null>();
  for (const r of cached ?? []) cachedById.set(r.category_id, r.external_id);
  for (const [cid, ext] of cachedById) {
    if (ext) {
      const n = Number(ext);
      if (Number.isFinite(n)) idMap.set(cid, n);
    }
  }

  // ── 4. Topo-sort root → leaf so parents resolve before children ──────────
  // We process in waves: any node whose parent is null OR already in idMap
  // is ready; loop until all nodes in `needed` are placed or stalled.
  const remaining = new Set<number>(neededArr);
  // Drop any already-resolved from cache; we still need to refresh status_at
  // but we don't have to call WC for them.
  const resolvedFromCache = new Set<number>(idMap.keys());
  for (const cid of resolvedFromCache) remaining.delete(cid);

  const upserts: Array<{
    instance_id: number;
    category_id: number;
    platform: "woocommerce";
    external_id: string;
    last_synced_at: string;
    last_status: "success";
    last_error: null;
  }> = [];
  const syncedAt = new Date().toISOString();

  let progressedThisWave = true;
  while (remaining.size > 0 && progressedThisWave) {
    progressedThisWave = false;
    for (const cid of Array.from(remaining)) {
      const row = byId.get(cid);
      if (!row) {
        remaining.delete(cid);
        failures.push({ categoryId: cid, error: "category_row_missing" });
        continue;
      }
      // Parent must be resolved before we can create.
      const parentScoutId = row.parent_category_id;
      let parentWcId = 0;
      if (parentScoutId !== null) {
        const m = idMap.get(parentScoutId);
        if (m === undefined) continue; // Wait for next wave.
        parentWcId = m;
      }

      // Try slug lookup first (idempotent on re-runs after a manual delete
      // of category_sync_status, or when the WC store already had a
      // matching category).
      let wcId: number | null = null;
      const lookup = await wcListCategories(wc, { slug: row.slug });
      if (!lookup.ok) {
        failures.push({ categoryId: cid, error: lookup.error });
        remaining.delete(cid);
        progressedThisWave = true;
        continue;
      }
      const existing = lookup.data.find((c) => c.slug === row.slug);
      if (existing) {
        wcId = existing.id;
      } else {
        const created = await wcCreateCategory(wc, {
          name: row.category_name,
          slug: row.slug,
          parent: parentWcId,
        });
        if (!created.ok) {
          failures.push({ categoryId: cid, error: created.error });
          remaining.delete(cid);
          progressedThisWave = true;
          continue;
        }
        wcId = created.data.id;
      }

      idMap.set(cid, wcId);
      upserts.push({
        instance_id: instanceId,
        category_id: cid,
        platform: "woocommerce",
        external_id: String(wcId),
        last_synced_at: syncedAt,
        last_status: "success",
        last_error: null,
      });
      remaining.delete(cid);
      progressedThisWave = true;
    }
  }

  // Anything left in `remaining` is unreachable (parent failed or cycle).
  for (const cid of remaining) {
    failures.push({ categoryId: cid, error: "parent_unresolved" });
  }

  if (upserts.length > 0) {
    await supabase
      .from("category_sync_status")
      .upsert(upserts, { onConflict: "instance_id,category_id,platform" });
  }

  return { idMap, failures };
}
