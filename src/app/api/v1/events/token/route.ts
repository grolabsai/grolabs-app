import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateInstanceEventsToken, meilisearchHost } from "@/lib/search/meilisearch-client";
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
 * POST /api/v1/events/token
 *
 * Mints a short-lived token the storefront uses to submit analytics events
 * (v0.3.0: search-result clicks) directly to Meilisearch's `/events` endpoint.
 *
 * Same trust model as /api/v1/search/token: instance_id is public, the Origin
 * header is the security boundary (must match a registered storefront domain),
 * rate limiting prevents abuse, and every failure returns the same generic 403
 * to prevent enumeration. Runs without a user JWT (the WordPress plugin calls
 * it from the browser), so the service-role Supabase client is used.
 *
 * Reuses the token rate-limit buckets — the storefront mints at most one
 * events token per page and refreshes only near expiry, so it shares the
 * existing token budget rather than carving out a new one.
 */

export const runtime = "nodejs";

const GENERIC_403: TokenErrorResponse = {
  error: "instance_not_found_or_origin_not_authorized",
};

function deny(origin: string | null): NextResponse {
  return corsify(NextResponse.json(GENERIC_403, { status: 403 }), origin);
}

function corsify(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
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

  // Accept number or numeric string. 0 is valid (template instance); use
  // Number.isFinite, not truthiness — see CLAUDE.md §2.
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
    console.error("[events/token] instance lookup failed:", error.message);
    return deny(origin);
  }
  if (!row || !row.is_active) return deny(origin);

  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) return deny(origin);

  // ── Mint the events token ───────────────────────────────────────────────
  let token: string, expiresAt: number, indexUid: string;
  try {
    const minted = await generateInstanceEventsToken(instanceId);
    token = minted.token;
    expiresAt = minted.expiresAt;
    indexUid = minted.indexUid;
  } catch (err) {
    console.error("[events/token] mint failed:", err instanceof Error ? err.message : err);
    return corsify(
      NextResponse.json({ error: "internal_error" }, { status: 500 }),
      origin
    );
  }

  // Activity Stream emission ("Events token minted for instance <id>") is
  // intentionally omitted: there is no Activity Stream infrastructure in the
  // codebase yet (the existing /api/v1/search/token route emits nothing
  // either). Wire this in when the Activity Stream lands.

  const payload: TokenResponse = {
    token,
    expires_at: expiresAt,
    meilisearch_host: meilisearchHost(),
    index_uid: indexUid ?? indexUidFor(instanceId),
  };
  return corsify(NextResponse.json(payload, { status: 200 }), origin);
}
