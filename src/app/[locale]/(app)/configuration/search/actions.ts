"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ping,
  ensureIndex,
  getDocumentCount,
  searchInstance,
} from "@/lib/search/meilisearch-client";
import { indexAllForInstance } from "@/lib/search/indexer";

/**
 * Server actions for /configuration/search (Stage 0 admin panel).
 *
 * Per docs/policy/search-foundations.md §8. Three actions:
 *   - testMeilisearchConnection: live health probe via the master key
 *   - saveStorefrontDomains:     normalize + persist instance.storefront_domains
 *   - initializeIndex:           idempotent createIndex + applyDefaultSettings
 */

export type ConnectionTestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

export async function testMeilisearchConnection(): Promise<ConnectionTestResult> {
  return ping();
}

export type SaveDomainsResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: "unauthorized" | "invalid_input" | "save_failed"; message?: string };

/**
 * Bare-hostname normalization. Strips scheme, port, path. Lowercases.
 * Drops empty entries and dedupes. Rejects entries that don't look like a host.
 */
function normalizeDomains(input: string[]): string[] | null {
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let host: string;
    try {
      // URL needs a scheme; tack one on if the user pasted a bare domain.
      const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      host = url.hostname;
    } catch {
      return null;
    }
    // Cheap sanity check — must contain at least one dot OR be localhost.
    if (host !== "localhost" && !host.includes(".")) return null;
    seen.add(host.toLowerCase());
  }
  return Array.from(seen).sort();
}

export async function saveStorefrontDomains(
  instanceId: number,
  rawDomains: string[]
): Promise<SaveDomainsResult> {
  const sb = await createClient();

  // Auth check — must be a member of the instance they're editing.
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  const normalized = normalizeDomains(rawDomains);
  if (normalized === null) return { ok: false, error: "invalid_input" };

  const { error } = await sb
    .from("instance")
    .update({ storefront_domains: normalized })
    .eq("instance_id", instanceId);
  if (error) return { ok: false, error: "save_failed", message: error.message };

  revalidatePath("/configuration/search");
  return { ok: true, domains: normalized };
}

export type InitIndexResult =
  | { ok: true; indexUid: string }
  | { ok: false; error: string };

export async function initializeIndex(instanceId: number): Promise<InitIndexResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  try {
    const indexUid = await ensureIndex(instanceId);
    return { ok: true, indexUid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

// ── Stage 1: indexing status + reindex ────────────────────────────────────

export type IndexingStatus = {
  meiliDocCount: number;
  scoutProductCount: number;
  lastSearchSyncAt: string | null;
  failedCount: number;
  pendingCount: number;
  /** True when the Meili count and GroLabs count agree. */
  inSync: boolean;
};

async function authorizeMembership(instanceId: number): Promise<boolean> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  return !!membership;
}

export async function getIndexingStatus(instanceId: number): Promise<IndexingStatus | null> {
  if (!(await authorizeMembership(instanceId))) return null;

  // Service-role for counts: we want exact totals regardless of RLS.
  const sb = createServiceRoleClient();

  const [meiliCount, scoutCount, instanceRow, failedCount, pendingCount] = await Promise.all([
    getDocumentCount(instanceId).catch(() => 0),
    sb
      .from("product")
      .select("product_id", { count: "exact", head: true })
      .eq("instance_id", instanceId)
      .eq("is_active", true),
    sb
      .from("instance")
      .select("last_search_sync_at")
      .eq("instance_id", instanceId)
      .maybeSingle(),
    sb
      .from("failed_indexing")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instanceId),
    sb
      .from("product_sync_status")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instanceId)
      .eq("platform", "meilisearch")
      .eq("last_status", "error"),
  ]);

  const scoutProductCount = scoutCount.count ?? 0;
  const meiliDocCount = meiliCount;
  const lastSearchSyncAt = (instanceRow.data?.last_search_sync_at as string | null) ?? null;

  return {
    meiliDocCount,
    scoutProductCount,
    lastSearchSyncAt,
    failedCount: failedCount.count ?? 0,
    pendingCount: pendingCount.count ?? 0,
    inSync: meiliDocCount === scoutProductCount,
  };
}

// ── Stage 1: in-app search preview ────────────────────────────────────────
//
// Powers the "Search preview" panel on the config screen so operators can dry-
// run queries against their own index without spinning up the storefront. This
// is the dashboard equivalent of the public /api/v1/search proxy — same index,
// same filter pinning, but authenticated via instance_member instead of an
// authorized storefront origin (so rate-limiting and the query_log write are
// intentionally skipped — this surface is staff-only).

export type SearchPreviewHit = {
  id: number;
  name: string;
  brand: string | null;
  price: number | null;
  salePrice: number | null;
  currency: string;
  inStock: boolean;
  sku: string | null;
  imageUrl: string | null;
  categories: string[];
};

export type SearchPreviewResult =
  | {
      ok: true;
      query: string;
      hits: SearchPreviewHit[];
      totalHits: number;
      processingTimeMs: number;
    }
  | { ok: false; error: "unauthorized" | "search_failed"; message?: string };

export async function previewSearch(
  instanceId: number,
  query: string,
): Promise<SearchPreviewResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  try {
    const raw = await searchInstance(instanceId, {
      query,
      limit: 12,
      // Defense in depth: same instance_id pin as the public proxy. A bug in
      // index routing or a stale shared index can never spill cross-instance.
      filter: `instance_id = ${instanceId}`,
    });

    const hits: SearchPreviewHit[] = raw.hits.map((h) => ({
      id: h.id,
      name: h.name,
      brand: h.brand ?? null,
      price: h.price ?? null,
      salePrice: h.sale_price ?? null,
      currency: h.currency ?? "",
      inStock: !!h.in_stock,
      sku: h.sku ?? null,
      imageUrl: h.thumbnail_url ?? h.image_url ?? null,
      categories: Array.isArray(h.categories) ? h.categories.slice(0, 2) : [],
    }));

    return {
      ok: true,
      query,
      hits,
      totalHits: raw.estimatedTotalHits,
      processingTimeMs: raw.processingTimeMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: "search_failed",
      message: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ── Request log diagnostics ───────────────────────────────────────────────
//
// Tails query_log for the request-log panel on /configuration/search. Each
// row represents one inbound /api/v1/search call (successes AND known-instance
// denials, per the route handler). The panel polls this on a short interval
// so operators can watch WP plugin traffic land in real time without leaving
// GroLabs.

export type SearchRequestLogHit = {
  wcId: number | null;
  name: string | null;
  variationId: number | null;
};

export type SearchRequestLogRow = {
  id: number;
  createdAt: string;
  query: string;
  origin: string | null;
  status: number;
  denialReason: string | null;
  totalHits: number | null;
  processingTimeMs: number | null;
  totalHandlerMs: number | null;
  hits: SearchRequestLogHit[];
};

export type RecentSearchRequestsResult =
  | { ok: true; rows: SearchRequestLogRow[] }
  | { ok: false; error: "unauthorized" };

/**
 * Most-recent N rows from query_log scoped to the caller's instance. RLS
 * already restricts SELECTs by instance_member, but we also gate on
 * authorizeMembership so unauthenticated requests get a clean error shape
 * rather than an empty list.
 */
export async function recentSearchRequests(
  instanceId: number,
  limit = 50,
): Promise<RecentSearchRequestsResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  const sb = await createClient();
  const { data } = await sb
    .from("query_log")
    .select("id, created_at, query, origin, status, denial_reason, total_hits, processing_time_ms, total_handler_ms, variant_selection")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  const rows: SearchRequestLogRow[] = (data ?? []).map((r) => {
    const rawSummary = r.variant_selection;
    const hits: SearchRequestLogHit[] = Array.isArray(rawSummary)
      ? rawSummary.map((h) => {
          const o = (h ?? {}) as Record<string, unknown>;
          return {
            wcId: typeof o.wc_id === "number" ? o.wc_id : null,
            name: typeof o.name === "string" ? o.name : null,
            variationId: typeof o.variation_id === "number" ? o.variation_id : null,
          };
        })
      : [];
    return {
      id: r.id as number,
      createdAt: r.created_at as string,
      query: (r.query as string) ?? "",
      origin: (r.origin as string | null) ?? null,
      status: (r.status as number) ?? 200,
      denialReason: (r.denial_reason as string | null) ?? null,
      // Successful rows from before the diagnostics columns existed still have
      // default 0 here, but they're not denials — surface them as-is.
      totalHits: r.total_hits == null ? null : (r.total_hits as number),
      processingTimeMs: r.processing_time_ms == null ? null : (r.processing_time_ms as number),
      totalHandlerMs: r.total_handler_ms == null ? null : (r.total_handler_ms as number),
      hits,
    };
  });

  return { ok: true, rows };
}

export type RunBackfillResult =
  | { ok: true; indexed: number; failed: number }
  | { ok: false; error: string };

export async function runFullBackfill(instanceId: number): Promise<RunBackfillResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  try {
    const result = await indexAllForInstance(instanceId, user.id);
    revalidatePath("/configuration/search");
    if (!result.ok) return { ok: false, error: result.error ?? "backfill failed" };
    return { ok: true, indexed: result.indexed, failed: result.failed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
