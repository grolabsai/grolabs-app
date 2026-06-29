import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { capturePostHog } from "@/lib/analytics/posthog";
import { searchInstance } from "@/lib/search/meilisearch-client";
import { assignIntent, type RecentQuery } from "@/lib/analytics/intent";
import { pickMatchedVariation, type MatchesPosition } from "@/lib/search/variant-matcher";
import { sanitizeFacets } from "@/lib/search/facets";
import type { SearchHit, SearchResponse, RreSearchDocument } from "@/lib/search/types";
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

type DenialReason =
  | "origin_not_authorized"
  | "instance_inactive"
  | "rate_limited"
  | "meilisearch_failed";

/**
 * Append a row to query_log. Successes get hits + processing time; denials
 * get a denial_reason and an HTTP status. Both paths share the same writer
 * so the `/configuration/search` request-log panel can present them in one
 * stream.
 *
 * Best-effort: a logging failure must never bubble out of the request
 * handler. We're diagnostics, not the primary path.
 */
async function logRequest(input: {
  instanceId: number;
  query: string;
  status: number;
  denialReason: DenialReason | null;
  totalHandlerMs: number;
  origin: string | null;
  hits?: SearchHit[];
  processingTimeMs?: number;
  queryUid?: string | null;
  userId?: string | null;
  accountId?: string | null;
  isCommitted?: boolean | null;
  commitReason?: string | null;
}): Promise<void> {
  try {
    const sb = createServiceRoleClient();
    const isSuccess = input.denialReason === null;

    // Intent grouping (skeleton): label this query with an intent_group_id so
    // consecutive same-meaning refinements from one session collapse to one
    // intent. Only for successful searches that carry a session + query — a
    // denial or anonymous-less search has no journey to stitch. Best-effort:
    // the read failing just leaves intent_group_id NULL.
    let intentGroupId: string | null = null;
    if (isSuccess && input.userId && input.query) {
      const { data: recentRows } = await sb
        .from("query_log")
        .select("query, intent_group_id")
        .eq("instance_id", input.instanceId)
        .eq("user_id", input.userId)
        .not("intent_group_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);
      const recent: RecentQuery[] = (recentRows ?? [])
        .filter((r): r is { query: string; intent_group_id: string } =>
          typeof r.query === "string" && typeof r.intent_group_id === "string"
        )
        .map((r) => ({ query: r.query, intentGroupId: r.intent_group_id }));
      intentGroupId = assignIntent(recent, input.query);
    }
    // Include wc_id + name so the request-log panel can show which products
    // we handed to the WordPress plugin — essential when WP says "no results"
    // but we returned non-zero hits (stale index, deleted products, etc.).
    const summary = isSuccess
      ? (input.hits ?? []).map((h) => ({
          product_id: h.document.id,
          variation_id: h.matched_variation?.variation_id ?? null,
          wc_id: h.document.woocommerce_id ?? null,
          name: h.document.name ?? null,
        }))
      : null;
    await sb.from("query_log").insert({
      instance_id: input.instanceId,
      query: input.query,
      total_hits: isSuccess ? input.hits?.length ?? 0 : 0,
      processing_time_ms: isSuccess ? input.processingTimeMs ?? 0 : 0,
      variant_selection: summary,
      origin: input.origin,
      status: input.status,
      denial_reason: input.denialReason,
      total_handler_ms: input.totalHandlerMs,
      query_uid: input.queryUid ?? null,
      user_id: input.userId ?? null,
      intent_group_id: intentGroupId,
      account_id: input.accountId ?? null,
      // Commitment is decided by the caller (results-page PHP = committed;
      // typeahead JS = prefix probe). NULL when the caller didn't say.
      is_committed: input.isCommitted ?? null,
      commit_reason: input.commitReason ?? null,
    });
  } catch (err) {
    console.error("[search] query_log insert failed:", err instanceof Error ? err.message : err);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const handlerStart = Date.now();
  const origin = req.headers.get("origin");
  const host = originToHost(origin);
  const ip = extractIp(req);

  // Per-IP rate limit (cheapest, do first). No instance_id resolved yet, so
  // this denial is invisible to the request-log panel — by design: pre-parse
  // throttling protects shared infrastructure, not a specific tenant.
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
  // Anonymous storefront session id (same id events.js mints). Persisted to
  // query_log.user_id so no-result searches + query sequences stitch into a
  // journey. Matches the `userId` field the /api/v1/events route reads.
  const userId = typeof b.userId === "string" ? b.userId.slice(0, 128) : null;
  // Option B identity: opaque (hashed) id of a logged-in storefront customer.
  // NULL for anonymous shoppers (they ride on userId, the browser id).
  const accountId = typeof b.accountId === "string" ? b.accountId.slice(0, 128) : null;
  // Commitment, marked at capture time by the caller. The results-page (PHP)
  // search sends committed=true; the typeahead (JS) sends committed=false so its
  // prefix probes can be excluded from search-quality KPIs. NULL when unsent.
  const isCommitted = typeof b.committed === "boolean" ? b.committed : null;
  const commitReason =
    typeof b.commit_reason === "string"
      ? b.commit_reason.slice(0, 32)
      : isCommitted === true
      ? "results_page"
      : isCommitted === false
      ? "typeahead"
      : null;
  const limit = typeof b.limit === "number" && Number.isFinite(b.limit) ? Math.min(Math.max(b.limit, 1), 100) : 20;
  const offset = typeof b.offset === "number" && Number.isFinite(b.offset) ? Math.max(b.offset, 0) : 0;
  const filters = typeof b.filters === "string" ? b.filters : undefined;
  const sort = Array.isArray(b.sort) ? b.sort.filter((s) => typeof s === "string") as string[] : undefined;
  // Allowlist-gated so a misconfigured caller can't request a high-cardinality
  // or non-filterable field. Unknown names drop silently — see facets.ts.
  const facets = sanitizeFacets(b.facets);

  // Validate instance + origin against DB. We do this BEFORE the pair rate
  // limit so a denial row can be FK-attached to the real instance — otherwise
  // an unknown instance_id couldn't be logged at all.
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
  // instance_id unknown to us — no FK target, nothing to surface in the panel.
  // Caller still gets the same generic 403 they'd get for origin mismatch.
  if (!row) return deny(origin);

  // From here on every exit path is loggable.
  if (!row.is_active) {
    void logRequest({
      instanceId,
      query,
      status: 403,
      denialReason: "instance_inactive",
      totalHandlerMs: Date.now() - handlerStart,
      origin: host,
      userId,
      accountId,
      isCommitted,
      commitReason,
    });
    return deny(origin);
  }

  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) {
    void logRequest({
      instanceId,
      query,
      status: 403,
      denialReason: "origin_not_authorized",
      totalHandlerMs: Date.now() - handlerStart,
      origin: host,
      userId,
      accountId,
      isCommitted,
      commitReason,
    });
    return deny(origin);
  }

  // Per-(instance, origin) rate limit. Now that we know the instance is real,
  // we can surface a throttled call in the panel.
  const pairOk = await checkRateLimit(
    searchBucketKey(instanceId, host),
    SEARCH_PER_INSTANCE_ORIGIN_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!pairOk) {
    void logRequest({
      instanceId,
      query,
      status: 429,
      denialReason: "rate_limited",
      totalHandlerMs: Date.now() - handlerStart,
      origin: host,
      userId,
      accountId,
      isCommitted,
      commitReason,
    });
    return corsify(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      origin
    );
  }

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
      facets: facets.length > 0 ? facets : undefined,
    });
  } catch (err) {
    console.error("[search] meilisearch failed:", err instanceof Error ? err.message : err);
    void logRequest({
      instanceId,
      query,
      status: 502,
      denialReason: "meilisearch_failed",
      totalHandlerMs: Date.now() - handlerStart,
      origin: host,
      userId,
      accountId,
      isCommitted,
      commitReason,
    });
    return corsify(
      NextResponse.json({ error: "search_failed" }, { status: 502 }),
      origin
    );
  }

  // Apply the variant matcher per hit.
  const hits: SearchHit[] = raw.hits.map((rawHit) => {
    const { _matchesPosition, ...doc } = rawHit;
    const document = doc as RreSearchDocument;
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
    ...(raw.facetDistribution ? { facets: raw.facetDistribution } : {}),
    ...(raw.facetStats ? { facet_stats: raw.facetStats } : {}),
  };

  // Best-effort logging — never blocks the response.
  void logRequest({
    instanceId,
    query,
    status: 200,
    denialReason: null,
    totalHandlerMs: Date.now() - handlerStart,
    origin: host,
    hits,
    processingTimeMs: response.processing_time_ms,
    queryUid: queryUid || null,
    userId,
    accountId,
    isCommitted,
    commitReason,
  });

  // Forward "Search Performed" to PostHog (best-effort, after the response is
  // sent). Zero-result searches are included on purpose — they are the signal
  // that drives the no-results funnel. query_uid stitches this to the click /
  // conversion events the /api/v1/events route forwards for the same search.
  const forwardSearchPerformed = () =>
    capturePostHog({
      distinctId: userId ?? "anonymous",
      event: "Search Performed",
      properties: {
        query,
        query_uid: queryUid || null,
        total_hits: response.total_hits,
        user_id: userId,
        instance_id: instanceId,
      },
    });
  // `after()` requires an active request scope. In production that always
  // exists; when the handler is invoked directly (integration tests call
  // POST(req) with no scope) `after()` throws. Fall back to fire-and-forget so
  // the forwarding still runs and the handler never throws.
  try {
    after(forwardSearchPerformed);
  } catch {
    void forwardSearchPerformed();
  }

  return corsify(NextResponse.json(response, { status: 200 }), origin);
}
