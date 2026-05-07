/**
 * Sync-status derivation logic.
 *
 * The `product_sync_status` table records `last_synced_at` per platform.
 * Whether a product is "synced" or "pending" depends on comparing that
 * value against the product's *effective* updated_at — the max of the
 * product's, its variants', and its pricing rows' updated_at columns.
 * If any of those changed after the last sync, the product is stale.
 *
 * Pure functions only. No DB calls.
 */

export type Platform = "algolia" | "woocommerce";

export type SyncStatus = "synced" | "pending" | "never";

/**
 * Compute the effective updated_at for a product. Pass in the
 * timestamps; this function does no DB I/O.
 *
 * Returns null only when every input is null — should never happen for a
 * real product (product.updated_at is NOT NULL in the schema).
 */
export function effectiveUpdatedAt(input: {
  productUpdatedAt: string | Date | null;
  variantUpdatedAts: Array<string | Date | null>;
  pricingUpdatedAts: Array<string | Date | null>;
}): Date | null {
  const candidates: Date[] = [];
  const push = (v: string | Date | null) => {
    if (v == null) return;
    const d = typeof v === "string" ? new Date(v) : v;
    if (!Number.isNaN(d.getTime())) candidates.push(d);
  };
  push(input.productUpdatedAt);
  for (const v of input.variantUpdatedAts) push(v);
  for (const v of input.pricingUpdatedAts) push(v);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Compare a product's effective updated_at against its last_synced_at
 * for one platform. Three-state:
 *
 *   "never"   — never synced (lastSyncedAt is null)
 *   "pending" — local change is newer than last sync
 *   "synced"  — last sync is newer or equal
 */
export function deriveStatus(input: {
  effectiveUpdatedAt: Date | null;
  lastSyncedAt: string | Date | null;
}): SyncStatus {
  if (input.lastSyncedAt == null) return "never";
  const synced =
    typeof input.lastSyncedAt === "string"
      ? new Date(input.lastSyncedAt)
      : input.lastSyncedAt;
  if (input.effectiveUpdatedAt == null) return "synced"; // shouldn't happen, but be safe
  return input.effectiveUpdatedAt.getTime() <= synced.getTime() ? "synced" : "pending";
}

// ─── Aggregate per-instance counters used by the badges + filter chips ─────

export type StatusCounts = {
  synced: number;
  pending: number;
  never: number;
  total: number;
};

export function countStatuses(rows: Array<{ status: SyncStatus }>): StatusCounts {
  const out: StatusCounts = { synced: 0, pending: 0, never: 0, total: 0 };
  for (const r of rows) {
    out.total += 1;
    out[r.status] += 1;
  }
  return out;
}
