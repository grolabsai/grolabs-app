import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateInstanceTenantToken, meilisearchHost } from "@/lib/search/meilisearch-client";
import { indexUidFor, type TokenResponse, type TokenErrorResponse } from "@/lib/search/types";
import {
  checkRateLimit,
  tokenBucketKey,
  tokenIpBucketKey,
  TOKEN_PER_INSTANCE_ORIGIN_PER_MIN,
  TOKEN_PER_IP_PER_MIN,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/search/rate-limit";

/**
 * POST /api/v1/search/token
 *
 * Per docs/policy/search-foundations.md §6 (Stage 0).
 *
 * Trust model: instance_id is public (like a Stripe publishable key). The
 * Origin header is the security boundary — it must match a domain the
 * merchant has registered on their instance. Rate limiting prevents abuse.
 *
 * Errors are deliberately generic to prevent enumeration: any failure (bad
 * instance_id, instance not found, instance not active, origin not
 * registered) returns the same 403 body.
 *
 * The WordPress plugin in Stage 1.5 calls this endpoint, so it runs without
 * a user JWT. We use the service-role Supabase client.
 */

export const runtime = "nodejs";

const GENERIC_403: TokenErrorResponse = {
  error: "instance_not_found_or_origin_not_authorized",
};

function deny(origin: string | null): NextResponse {
  return corsify(NextResponse.json(GENERIC_403, { status: 403 }), origin);
}

function corsify(res: NextResponse, origin: string | null): NextResponse {
  // Per policy: echo Origin only when validated, never `*`. Validation has
  // already happened by the time we call this on a 200; on 403/429 we still
  // echo to keep the browser happy with CORS, but the response body itself
  // tells the caller nothing useful.
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Strip scheme + port from an Origin header to get a bare hostname.
 * `https://shop.wazu.gt:443` → `shop.wazu.gt`. Returns null on malformed input.
 */
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const host = originToHost(origin);
  const ip = extractIp(req);

  // ── Per-IP rate limit (cheapest check, do first) ─────────────────────────
  const ipOk = await checkRateLimit(
    tokenIpBucketKey(ip),
    TOKEN_PER_IP_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!ipOk) {
    return corsify(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      origin
    );
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return deny(origin);
  }
  if (!body || typeof body !== "object") return deny(origin);
  const rawInstanceId = (body as Record<string, unknown>).instance_id;

  // Accept number or numeric string. Reject anything else.
  // 0 is valid (template instance); use Number.isFinite, not truthiness.
  const instanceId =
    typeof rawInstanceId === "number"
      ? rawInstanceId
      : typeof rawInstanceId === "string" && rawInstanceId.length > 0
      ? Number(rawInstanceId)
      : Number.NaN;

  if (!Number.isFinite(instanceId) || !Number.isInteger(instanceId) || instanceId < 0) {
    return deny(origin);
  }

  // ── Origin must be present ──────────────────────────────────────────────
  if (!host) return deny(origin);

  // ── Per-(instance, origin) rate limit ───────────────────────────────────
  const pairOk = await checkRateLimit(
    tokenBucketKey(instanceId, host),
    TOKEN_PER_INSTANCE_ORIGIN_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!pairOk) {
    return corsify(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      origin
    );
  }

  // ── Validate instance + origin against DB ───────────────────────────────
  const sb = createServiceRoleClient();
  const { data: row, error } = await sb
    .from("instance")
    .select("instance_id, is_active, storefront_domains")
    .eq("instance_id", instanceId)
    .maybeSingle();

  if (error) {
    console.error("[search/token] instance lookup failed:", error.message);
    return deny(origin);
  }
  if (!row || !row.is_active) return deny(origin);

  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) return deny(origin);

  // ── Mint the tenant token ───────────────────────────────────────────────
  let token: string, expiresAt: number, indexUid: string;
  try {
    const minted = await generateInstanceTenantToken(instanceId);
    token = minted.token;
    expiresAt = minted.expiresAt;
    indexUid = minted.indexUid;
  } catch (err) {
    console.error("[search/token] mint failed:", err instanceof Error ? err.message : err);
    return corsify(
      NextResponse.json({ error: "internal_error" }, { status: 500 }),
      origin
    );
  }

  const payload: TokenResponse = {
    token,
    expires_at: expiresAt,
    meilisearch_host: meilisearchHost(),
    index_uid: indexUid ?? indexUidFor(instanceId),
  };
  return corsify(NextResponse.json(payload, { status: 200 }), origin);
}
