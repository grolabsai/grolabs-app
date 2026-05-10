"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ping, ensureIndex, getDocumentCount } from "@/lib/search/meilisearch-client";
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
  /** True when the Meili count and Scout count agree. */
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
