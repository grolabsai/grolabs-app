import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { capturePostHog } from "@/lib/analytics/posthog";

/**
 * POST /api/v1/events
 *
 * Storefront analytics receiver. Mirrors what the WP plugin posts to
 * Meilisearch's analytics dashboard so the GroLabs admin can surface the
 * same data inside the app — Meilisearch Cloud's Build tier has no
 * programmatic read API for events, so a local copy is the only way to
 * power the events panel on /configuration/search.
 *
 * Trust model is identical to /api/v1/search:
 *   - instance_id is public (Stripe-publishable-key class).
 *   - Origin header is validated against instance.storefront_domains.
 *   - No auth header from the storefront; the storefront IS the
 *     authorized caller iff its origin is whitelisted.
 *
 * Best-effort: response body never carries data sensitive to leak. The
 * plugin uses keepalive POSTs that fire-and-forget; a non-200 here is
 * silently dropped, which is acceptable for an analytics path.
 */

export const runtime = "nodejs";

// ── CORS helpers ─────────────────────────────────────────────────────────
//
// Same shape as /api/v1/search. Origin reflection is required so the
// browser accepts the response when the WP plugin POSTs cross-origin from
// the storefront.

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

// ── Allowed event names ──────────────────────────────────────────────────
//
// Locked list per docs/policy/search-events.md §2. We accept other names
// too (text column), but reject obviously-malformed payloads at insert
// time below. Keep this for the eventName-counts panel + future
// allowlist enforcement.

const KNOWN_EVENT_TYPES = new Set(["click", "conversion"]);

// ── Handler ──────────────────────────────────────────────────────────────

type EventBody = {
  instance_id?: unknown;
  eventType?: unknown;
  eventName?: unknown;
  userId?: unknown;
  queryUid?: unknown;
  indexUid?: unknown;
  objectId?: unknown;
  objectName?: unknown;
  position?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const host = originToHost(origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return deny(origin, 400);
  }
  if (!body || typeof body !== "object") return deny(origin, 400);
  const b = body as EventBody;

  // instance_id resolution — accept number or numeric string. 0 is
  // valid (template instance). Use strict NaN/integer checks; never
  // coerce a falsy value to a default.
  const rawInstanceId = b.instance_id;
  const instanceId =
    typeof rawInstanceId === "number"
      ? rawInstanceId
      : typeof rawInstanceId === "string" && rawInstanceId.length > 0
      ? Number(rawInstanceId)
      : Number.NaN;
  if (!Number.isFinite(instanceId) || !Number.isInteger(instanceId) || instanceId < 0) {
    return deny(origin, 400);
  }

  if (!host) return deny(origin);

  // Minimum payload: eventType + eventName. Everything else is
  // optional — the plugin sometimes ships a queryUid-less event by
  // mistake (defensive logging) and we'd rather record the noise than
  // drop signal.
  const eventType = typeof b.eventType === "string" ? b.eventType.trim() : "";
  const eventName = typeof b.eventName === "string" ? b.eventName.trim() : "";
  if (!eventType || !eventName) return deny(origin, 400);
  if (eventType.length > 64 || eventName.length > 256) return deny(origin, 400);
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    // Accept it anyway — future event types should land cleanly without
    // a RRE deploy — but log so operators can spot drift between
    // plugin and backend taxonomies.
    console.warn("[events] unknown eventType:", eventType);
  }

  const sb = createServiceRoleClient();

  // Validate instance + origin. Same denial path as /api/v1/search so
  // both endpoints share the trust model. If a storefront isn't
  // whitelisted, no events get recorded — which prevents a malicious
  // origin from spamming our analytics with junk attributed to someone
  // else's instance.
  const { data: row, error } = await sb
    .from("instance")
    .select("instance_id, is_active, storefront_domains")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (error) {
    console.error("[events] instance lookup failed:", error.message);
    return deny(origin);
  }
  if (!row || !row.is_active) return deny(origin);
  const domains: string[] = Array.isArray(row.storefront_domains) ? row.storefront_domains : [];
  if (!domains.includes(host)) return deny(origin);

  // Coerce optional fields to safe types. Defensive — never trust the
  // sender to send a number where a number is expected.
  const userId    = typeof b.userId    === "string" ? b.userId.slice(0, 128)    : null;
  const queryUid  = typeof b.queryUid  === "string" ? b.queryUid.slice(0, 128)  : null;
  const indexUid  = typeof b.indexUid  === "string" ? b.indexUid.slice(0, 128)  : null;
  const objectId  = b.objectId == null ? null : String(b.objectId).slice(0, 128);
  const objectName = typeof b.objectName === "string" ? b.objectName.slice(0, 512) : null;
  const position =
    typeof b.position === "number" && Number.isFinite(b.position) && b.position >= 0
      ? Math.min(Math.round(b.position), 32767) // smallint cap
      : null;

  const { error: insertError } = await sb.from("analytics_event").insert({
    instance_id: instanceId,
    event_type: eventType,
    event_name: eventName,
    user_id: userId,
    query_uid: queryUid,
    index_uid: indexUid,
    object_id: objectId,
    object_name: objectName,
    position,
    origin: host,
  });

  if (insertError) {
    // Don't leak DB errors to the storefront. Log + 500 — the plugin
    // already treats event POSTs as fire-and-forget, so the storefront
    // user never sees this.
    console.error("[events] analytics_event insert failed:", insertError.message);
    return corsify(
      NextResponse.json({ error: "event_recording_failed" }, { status: 500 }),
      origin
    );
  }

  // Mirror the event to PostHog (best-effort, after the response is sent).
  // distinct_id is the anonymous storefront session id. We resolve queryUid ->
  // keyword from query_log so the click/conversion event carries the search
  // term that produced it — closing the keyword↔conversion loop without the
  // storefront having to re-send the query string.
  after(async () => {
    let keyword: string | null = null;
    if (queryUid) {
      const { data: logRow } = await sb
        .from("query_log")
        .select("query")
        .eq("instance_id", instanceId)
        .eq("query_uid", queryUid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      keyword = typeof logRow?.query === "string" ? logRow.query : null;
    }
    await capturePostHog({
      distinctId: userId ?? "anonymous",
      event: eventName,
      properties: {
        event_type: eventType,
        query_uid: queryUid,
        keyword,
        position,
        object_id: objectId,
        object_name: objectName,
        index_uid: indexUid,
        instance_id: instanceId,
      },
    });
  });

  return corsify(NextResponse.json({ ok: true }, { status: 200 }), origin);
}
