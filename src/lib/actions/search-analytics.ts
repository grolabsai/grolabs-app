"use server";

import { createClient } from "@/lib/supabase/server";
import { getServerStats } from "@/lib/search/meilisearch-client";

/**
 * Server actions for the portable analytics blocks under
 * `src/components/analytics/*`. Each block calls exactly one of these from a
 * client component on mount. They are scoped to one instance and re-check
 * membership on every call (RLS on `query_log` already filters, but the
 * explicit gate gives us a clean error shape for unauthenticated reads).
 *
 * The blocks are designed to be moved to other pages (a dashboard, an admin
 * overview, etc.) without changes — so these actions stay shape-stable and
 * take only the parameters the block exposes in its props.
 */

const MAX_DAYS = 90;
const MAX_LIMIT = 50;
const RAW_ROW_CAP = 10000;

function clampDays(days: number): number {
  if (!Number.isFinite(days) || days < 1) return 7;
  return Math.min(Math.floor(days), MAX_DAYS);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 10;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function authorize(instanceId: number): Promise<boolean> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const { data } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

export type AnalyticsError = { ok: false; error: "unauthorized" | "query_failed" };

// ── 1. Search volume ──────────────────────────────────────────────────────
//
// Total successful searches in the window + a daily bucket series so the
// block can render a sparkline alongside the headline number.

export type SearchVolumeResult =
  | {
      ok: true;
      days: number;
      total: number;
      perDay: Array<{ date: string; count: number }>;
    }
  | AnalyticsError;

export async function analyticsSearchVolume(
  instanceId: number,
  days: number,
): Promise<SearchVolumeResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("created_at")
    .eq("status", 200)
    .gte("created_at", sinceIso(d))
    .order("created_at", { ascending: true })
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const buckets = new Map<string, number>();
  for (let i = d - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(key, 0);
  }
  for (const r of data ?? []) {
    const key = (r.created_at as string).slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return {
    ok: true,
    days: d,
    total: data?.length ?? 0,
    perDay: Array.from(buckets, ([date, count]) => ({ date, count })),
  };
}

// ── 2. No-result rate ─────────────────────────────────────────────────────

export type NoResultRateResult =
  | {
      ok: true;
      days: number;
      total: number;
      noResultCount: number;
      rate: number;
    }
  | AnalyticsError;

export async function analyticsNoResultRate(
  instanceId: number,
  days: number,
): Promise<NoResultRateResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("total_hits")
    .eq("status", 200)
    .gte("created_at", sinceIso(d))
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const total = data?.length ?? 0;
  const noResultCount = (data ?? []).filter((r) => (r.total_hits ?? 0) === 0).length;
  const rate = total > 0 ? noResultCount / total : 0;

  return { ok: true, days: d, total, noResultCount, rate };
}

// ── 3. Latency (Meilisearch processing time) ──────────────────────────────

export type LatencyResult =
  | {
      ok: true;
      days: number;
      sampleSize: number;
      meiliP50: number;
      meiliP95: number;
      handlerP50: number;
      handlerP95: number;
    }
  | AnalyticsError;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export async function analyticsLatency(
  instanceId: number,
  days: number,
): Promise<LatencyResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("processing_time_ms, total_handler_ms")
    .eq("status", 200)
    .gte("created_at", sinceIso(d))
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const meili: number[] = [];
  const handler: number[] = [];
  for (const r of data ?? []) {
    if (typeof r.processing_time_ms === "number") meili.push(r.processing_time_ms);
    if (typeof r.total_handler_ms === "number") handler.push(r.total_handler_ms);
  }
  meili.sort((a, b) => a - b);
  handler.sort((a, b) => a - b);

  return {
    ok: true,
    days: d,
    sampleSize: meili.length,
    meiliP50: percentile(meili, 0.5),
    meiliP95: percentile(meili, 0.95),
    handlerP50: percentile(handler, 0.5),
    handlerP95: percentile(handler, 0.95),
  };
}

// ── 4. Top queries (success path) ─────────────────────────────────────────

export type TopQueriesResult =
  | {
      ok: true;
      days: number;
      rows: Array<{ query: string; count: number }>;
    }
  | AnalyticsError;

export async function analyticsTopQueries(
  instanceId: number,
  days: number,
  limit: number,
): Promise<TopQueriesResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const n = clampLimit(limit);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("query")
    .eq("status", 200)
    .gte("created_at", sinceIso(d))
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const q = (r.query as string)?.trim();
    if (!q) continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const rows = Array.from(counts, ([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

  return { ok: true, days: d, rows };
}

// ── 5. Top no-result queries ──────────────────────────────────────────────

export type TopNoResultQueriesResult = TopQueriesResult;

export async function analyticsTopNoResultQueries(
  instanceId: number,
  days: number,
  limit: number,
): Promise<TopNoResultQueriesResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const n = clampLimit(limit);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("query")
    .eq("status", 200)
    .eq("total_hits", 0)
    .gte("created_at", sinceIso(d))
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const q = (r.query as string)?.trim();
    if (!q) continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const rows = Array.from(counts, ([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

  return { ok: true, days: d, rows };
}

// ── 6. Storefront breakdown (per Origin) ──────────────────────────────────

export type StorefrontBreakdownResult =
  | {
      ok: true;
      days: number;
      rows: Array<{ origin: string | null; count: number }>;
    }
  | AnalyticsError;

export async function analyticsStorefrontBreakdown(
  instanceId: number,
  days: number,
): Promise<StorefrontBreakdownResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  const d = clampDays(days);
  const sb = await createClient();

  const { data, error } = await sb
    .from("query_log")
    .select("origin")
    .eq("status", 200)
    .gte("created_at", sinceIso(d))
    .limit(RAW_ROW_CAP);
  if (error) return { ok: false, error: "query_failed" };

  const counts = new Map<string | null, number>();
  for (const r of data ?? []) {
    const o = (r.origin as string | null) ?? null;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const rows = Array.from(counts, ([origin, count]) => ({ origin, count })).sort(
    (a, b) => b.count - a.count,
  );

  return { ok: true, days: d, rows };
}

// ── 7. Meilisearch index health (doc count, indexing flag, field dist) ────

export type IndexHealthResult =
  | {
      ok: true;
      numberOfDocuments: number;
      isIndexing: boolean;
      databaseSize: number;
      usedDatabaseSize: number;
      rawDocumentDbSize: number;
      avgDocumentSize: number;
      lastUpdate: string | null;
      fieldDistribution: Array<{ field: string; count: number }>;
    }
  | AnalyticsError;

export async function analyticsIndexHealth(
  instanceId: number,
): Promise<IndexHealthResult> {
  if (!(await authorize(instanceId))) return { ok: false, error: "unauthorized" };
  try {
    const s = await getServerStats(instanceId);
    const fieldDistribution = Object.entries(s.index?.fieldDistribution ?? {})
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: true,
      numberOfDocuments: s.index?.numberOfDocuments ?? 0,
      isIndexing: s.index?.isIndexing ?? false,
      databaseSize: s.databaseSize,
      usedDatabaseSize: s.usedDatabaseSize,
      rawDocumentDbSize: s.index?.rawDocumentDbSize ?? 0,
      avgDocumentSize: s.index?.avgDocumentSize ?? 0,
      lastUpdate: s.lastUpdate,
      fieldDistribution,
    };
  } catch {
    return { ok: false, error: "query_failed" };
  }
}
