import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { searchInstance } from "@/lib/search/meilisearch-client";
import { pickMatchedVariation, type MatchesPosition } from "@/lib/search/variant-matcher";
import type { SearchHit, SearchResponse, ScoutSearchDocument } from "@/lib/search/types";
import {
  checkRateLimit,
  searchBucketKey,
  searchIpBucketKey,
  SEARCH_PER_INSTANCE_ORIGIN_PER_MIN,
  SEARCH_PER_IP_PER_MIN,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/search/rate-limit";

/**
 * POST /api/v1/search
 *
 * Per docs/policy/search-foundations.md §7. The middle-layer endpoint the
 * WordPress plugin calls. Validates instance + origin, talks to Meilisearch
 * with the master-key client, runs the variant matcher (PR #68 contract:
 * matched_variation is a full variant object), logs to query_log.
 *
 * The plugin runs without a user JWT, so we use the service-role client for
 * the instance/origin lookup. Same trust model as /api/v1/search/token.
 */

export const runtime = "nodejs";

// ── CORS / helpers ───────────────────────────────────────────────────────

function corsify(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function deny(origin: string | null, status = 403): NextResponse {
  return corsify(
    NextResponse.json(
      { error: "instance_not_found_or_origin_not_authorized" },
      { status }
    ),
    origin
  );
}

function originToHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

function extractIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}

// ── Logging ──────────────────────────────────────────────────────────────

async function logQuery(input: {
  instanceId: number;
  query: string;
  totalHits: number;
  processingTimeMs: number;
  hits: SearchHit[];
  origin: string | null;
}): Promise<void> {
  try {
    const sb = createServiceRoleClient();
    const summary = input.hits.map((h) => ({
      product_id: h.document.id,
      variation_id: h.matched_variation?.variation_id ?? null,
    }));
    await sb.from("query_log").insert({
      instance_id: input.instanceId,
      query: input.query,
      total_hits: input.totalHits,
      processing_time_ms: input.processingTimeMs,
      variant_selection: summary,
      origin: input.origin,
    });
  } catch (err) {
    // Logging failures must never break the search response. The Stage 1
    // policy treats query_log as best-effort analytics, not a primary path.
    console.error("[search] query_log insert failed:", err instanceof Error ? err.message : err);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const host = originToHost(origin);
  const ip = extractIp(req);

  // Per-IP rate limit (cheapest, do first).
  const ipOk = await checkRateLimit(
    searchIpBucketKey(ip),
    SEARCH_PER_IP_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!ipOk) {
    return corsify(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      origin
    );
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return deny(origin);
  }
  if (!body || typeof body !== "object") return deny(origin);
  const b = body as Record<string, unknown>;

  const rawInstanceId = b.instance_id;
  const instanceId =
    typeof rawInstanceId === "number"
      ? rawInstanceId
      : typeof rawInstanceId === "string" && rawInstanceId.length > 0
      ? Number(rawInstanceId)
      : Number.NaN;
  if (!Number.isFinite(instanceId) || !Number.isInteger(instanceId) || instanceId < 0) {
    return deny(origin);
  }

  if (!host) return deny(origin);

  const query = typeof b.query === "string" ? b.query : "";
  const limit = typeof b.limit === "number" && Number.isFinite(b.limit) ? Math.min(Math.max(b.limit, 1), 100) : 20;
  const offset = typeof b.offset === "number" && Number.isFinite(b.offset) ? Math.max(b.offset, 0) : 0;
  const filters = typeof b.filters === "string" ? b.filters : undefined;
  const sort = Array.isArray(b.sort) ? b.sort.filter((s) => typeof s === "string") as string[] : undefined;

  // Per-(instance, origin) rate limit.
  const pairOk = await checkRateLimit(
    searchBucketKey(instanceId, host),
    SEARCH_PER_INSTANCE_ORIGIN_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!pairOk) {
    return corsify(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      origin
    );
  }

  // Validate instance + origin against DB.
  const sb = createServiceRoleClient();
  const { data: row, error } = await sb
    .from("instance")
    .select("instance_id, is_active, storefront_domains")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (error) {
    console.error("[search] instance lookup failed:", error.message);
    return deny(origin);
  }
  if (!row || !row.is_active) return deny(origin);
  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) return deny(origin);

  // Defense in depth: prefix any caller-supplied filter with the instance_id
  // filter so the index can't be searched without it (even though tenant
  // tokens already enforce this — we're not using a token here, we use the
  // master-key client for the proxy).
  const instanceFilter = `instance_id = ${instanceId}`;
  const finalFilter = filters ? `(${filters}) AND ${instanceFilter}` : instanceFilter;

  // Search.
  let raw;
  try {
    raw = await searchInstance(instanceId, {
      query,
      limit,
      offset,
      filter: finalFilter,
      sort,
    });
  } catch (err) {
    console.error("[search] meilisearch failed:", err instanceof Error ? err.message : err);
    return corsify(
      NextResponse.json({ error: "search_failed" }, { status: 502 }),
      origin
    );
  }

  // Apply the variant matcher per hit.
  const hits: SearchHit[] = raw.hits.map((rawHit) => {
    const { _matchesPosition, ...doc } = rawHit;
    const document = doc as ScoutSearchDocument;
    const matched_variation = pickMatchedVariation(
      document,
      _matchesPosition as MatchesPosition | undefined
    );
    return { document, matched_variation };
  });

  // Surface Meilisearch's real analytics identifiers. The storefront reports
  // click events against metadata.queryUid so Meilisearch can attribute them
  // to this exact query — a locally-generated UUID would break that link.
  const queryUid = raw.metadata?.queryUid ?? "";
  const response: SearchResponse = {
    hits,
    total_hits: raw.estimatedTotalHits,
    processing_time_ms: raw.processingTimeMs,
    query_uid: queryUid,
    metadata: {
      queryUid,
      requestUid: raw.metadata?.requestUid ?? "",
      indexUid: raw.metadata?.indexUid ?? "",
    },
  };

  // Best-effort logging — never blocks the response.
  void logQuery({
    instanceId,
    query,
    totalHits: response.total_hits,
    processingTimeMs: response.processing_time_ms,
    hits,
    origin: host,
  });

  return corsify(NextResponse.json(response, { status: 200 }), origin);
}
