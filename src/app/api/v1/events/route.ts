import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { capturePostHog } from "@/lib/analytics/posthog";
import {
  checkRateLimit,
  eventsBucketKey,
  eventsIpBucketKey,
  EVENTS_PER_INSTANCE_ORIGIN_PER_MIN,
  EVENTS_PER_IP_PER_MIN,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/search/rate-limit";

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

function extractIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
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
    // Authorization is required here now (SEC-003). Omitting it from the
    // preflight would fail every batch at the OPTIONS, before a single event
    // was sent — and silently, because the storefront treats reporting as
    // fire-and-forget.
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

// 'cart_remove' is own-store-only (no Meilisearch path, no queryUid meaning) —
// it lets cart value be computed as adds − removes − purchases. See
// docs/design/event-tracking.md.
const KNOWN_EVENT_TYPES = new Set(["click", "conversion", "cart_remove", "view"]);

// ── Reporter authentication (SEC-003) ────────────────────────────────────
//
// `Origin` is not an authenticator. A browser will not let a page lie about
// its own origin, but nothing else is a browser: from curl it is a header you
// type. Before this, anyone who knew a merchant's myshopify.com domain — which
// is in the storefront's URL — could inject fabricated searches, clicks and
// revenue for that instance.
//
// The credential is the instance's existing storefront search key, the one
// already sitting in the theme block and the pixel settings. Reusing it means
// no new merchant step, no second thing to paste, and no second thing to
// forget. It also means revoking a merchant stops their telemetry as well as
// their search, which is the behaviour the manual-cutoff design wants anyway
// (R-9).
//
// REQUIRED ONLY WHERE A LIVE KEY EXISTS. An instance that has never been
// provisioned is not on direct mode, still reports through the old
// single-event path, and must keep working — the same "blank changes nothing"
// rule Phase 2 follows. Instances convert to authenticated reporting the
// moment they are given a key.
//
// Honest about the ceiling: this key is public by design — it ships in page
// source. So this raises the bar from "knows the shop's domain" to "has read
// that shop's page source", which defeats blind and scripted forgery but not a
// determined attacker. Sealing it needs a signed, expiring token, which is
// precisely the renewal machinery R-2 removed on purpose. See SEC-003 before
// reaching for that.
type ReportAuth = "ok" | "not_required" | "rejected";

async function verifyReporter(
  sb: ReturnType<typeof createServiceRoleClient>,
  instanceId: number,
  req: NextRequest,
): Promise<ReportAuth> {
  const { data, error } = await sb
    .from("search_key")
    .select("key_value")
    .eq("instance_id", instanceId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    // Fail OPEN, deliberately, and loudly. This endpoint is best-effort
    // analytics: losing a merchant's telemetry because our own database
    // hiccuped is a worse outcome than accepting an unverified event, and an
    // attacker cannot cause this branch.
    console.error("[events] reporter key lookup failed, accepting:", error.message);
    return "not_required";
  }

  const expected = typeof data?.key_value === "string" ? data.key_value : null;
  if (!expected) return "not_required"; // not on direct mode

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return presented && presented === expected ? "ok" : "rejected";
}

// ── Handler ──────────────────────────────────────────────────────────────

type EventBody = {
  instance_id?: unknown;
  eventType?: unknown;
  eventName?: unknown;
  userId?: unknown;
  accountId?: unknown;
  queryUid?: unknown;
  indexUid?: unknown;
  objectId?: unknown;
  objectName?: unknown;
  position?: unknown;
  orderId?: unknown;
  cartId?: unknown;
  value?: unknown;
  quantity?: unknown;
  placement?: unknown;
  /** Batch form. When present, every other top-level field is ignored. */
  events?: unknown;
};

/** How many events one request may carry. A storefront batch is a handful of
 *  funnel events plus the searches since the last flush; anything far past
 *  this is a client bug or someone probing, and either way we would rather
 *  reject it than accept an unbounded insert. */
const MAX_BATCH = 200;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const host = originToHost(origin);

  // Per-IP first, before parsing: throttling that happens after you have
  // already done the expensive part is not throttling. No instance is
  // resolved yet, so this protects shared infrastructure rather than a
  // specific tenant.
  const ip = extractIp(req);
  const ipOk = await checkRateLimit(
    eventsIpBucketKey(ip),
    EVENTS_PER_IP_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!ipOk) {
    return corsify(NextResponse.json({ error: "rate_limited" }, { status: 429 }), origin);
  }

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

  const reporter = await verifyReporter(sb, instanceId, req);
  if (reporter === "rejected") {
    // Same opaque body as every other denial here: a caller probing which
    // instances exist, or whether their guessed key was close, learns nothing
    // from the difference between "wrong key" and "wrong origin".
    return deny(origin, 403);
  }

  // Per-(instance, origin): a whole storefront's traffic shares this bucket,
  // so it is wide. It exists to stop one merchant's runaway loop from
  // crowding out every other tenant, not to police an individual shopper.
  const instanceOk = await checkRateLimit(
    eventsBucketKey(instanceId, host),
    EVENTS_PER_INSTANCE_ORIGIN_PER_MIN,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!instanceOk) {
    return corsify(NextResponse.json({ error: "rate_limited" }, { status: 429 }), origin);
  }

  // ── Batch path (R-10) ──────────────────────────────────────────────────
  //
  // Now that the storefront searches Meilisearch directly, a search only
  // reaches query_log by being reported afterwards. So reporting is
  // accept-fast: append the batch to event_inbox, answer 202, and let the
  // drainer do the real work. Anything that fails after we said 202 is ours
  // to retry, not the shopper's to notice.
  //
  // The single-event path below is untouched on purpose. It is what the WP
  // plugin and today's pixel still use, and flipping it to async in the same
  // change would put every existing event behind a drainer that has never run
  // in production. Phase 7 retires it.
  const batch = Array.isArray(b.events) ? b.events : null;
  if (batch) {
    return await acceptBatch(sb, instanceId, host, origin, batch);
  }

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

  // Coerce optional fields to safe types. Defensive — never trust the
  // sender to send a number where a number is expected.
  const userId    = typeof b.userId    === "string" ? b.userId.slice(0, 128)    : null;
  // Option B identity (logged-in storefront customer) + journey keys. All
  // nullable — un-gated journey events arrive without search lineage.
  const accountId = typeof b.accountId === "string" ? b.accountId.slice(0, 128) : null;
  const orderId   = typeof b.orderId   === "string" ? b.orderId.slice(0, 128)   : (b.orderId == null ? null : String(b.orderId).slice(0, 128));
  const cartId    = typeof b.cartId    === "string" ? b.cartId.slice(0, 128)    : null;
  // Order line value + quantity (Sales KPIs). Coerce numeric strings too.
  const valueNum  = typeof b.value === "number" ? b.value : (typeof b.value === "string" && b.value.trim() !== "" ? Number(b.value) : NaN);
  const value     = Number.isFinite(valueNum) && valueNum >= 0 ? valueNum : null;
  const qtyNum    = typeof b.quantity === "number" ? b.quantity : (typeof b.quantity === "string" && b.quantity.trim() !== "" ? Number(b.quantity) : NaN);
  const quantity  = Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.min(Math.round(qtyNum), 32767) : null;
  // Placement = the on-site surface a product interaction came from (pdp, plp,
  // search_results, related, a raw block heading, …). Replaces the old two-name
  // add-to-cart split; carried as a free dimension, normalised in analysis.
  const placement = typeof b.placement === "string" && b.placement.trim() !== "" ? b.placement.slice(0, 80) : null;
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
    account_id: accountId,
    order_id: orderId,
    cart_id: cartId,
    value,
    quantity,
    placement,
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

// ── Batch acceptance ───────────────────────────────────────────────────────

type InboxRow = {
  event_id: string;
  instance_id: number;
  kind: string;
  payload: Record<string, unknown>;
  origin: string;
  /** Per-session counter; a gap between delivered values is a lost event (R-14). */
  seq: number | null;
  session_id: string | null;
};

/**
 * Append a reported batch to `event_inbox` and answer 202.
 *
 * Validation here is deliberately shallow: enough to keep the table clean
 * (an id, a kind, a bounded size) and no more. Rejecting a whole batch
 * because one event has an odd field would lose the other 49, and the
 * storefront cannot fix it — it has already moved on. The drainer is where
 * per-event shape is enforced, because that is where a bad event can be
 * parked (`last_error`) without taking its neighbours down.
 *
 * `event_id` is the client's idempotency key and the reason retrying a batch
 * is safe: a duplicate collides on the primary key and is ignored rather than
 * double-counted. A batch that is all duplicates is a SUCCESSFUL retry, not an
 * error, and is answered 202 like any other.
 */
async function acceptBatch(
  sb: ReturnType<typeof createServiceRoleClient>,
  instanceId: number,
  host: string,
  origin: string | null,
  events: unknown[],
): Promise<NextResponse> {
  if (events.length === 0) {
    return corsify(NextResponse.json({ accepted: 0 }, { status: 202 }), origin);
  }
  if (events.length > MAX_BATCH) return deny(origin, 400);

  const rows: InboxRow[] = [];
  let skipped = 0;

  for (const raw of events) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const e = raw as Record<string, unknown>;

    // No id, no idempotency, no safe retry — so no insert.
    const eventId = typeof e.event_id === "string" ? e.event_id.trim() : "";
    if (!eventId || eventId.length > 128) {
      skipped++;
      continue;
    }

    // `kind` routes the drain. Fall back to eventType so a client that only
    // knows the older vocabulary still lands somewhere sensible.
    const kind =
      typeof e.kind === "string" && e.kind.trim() !== ""
        ? e.kind.trim().slice(0, 64)
        : typeof e.eventType === "string"
          ? e.eventType.trim().slice(0, 64)
          : "";
    if (!kind) {
      skipped++;
      continue;
    }

    // Lifted out of the payload into real columns so fidelity can be measured
    // with a GROUP BY instead of a jsonb scan. Both are optional: an event
    // without them still records, it just cannot be checked for gaps.
    const seqRaw = e.seq;
    const seq =
      typeof seqRaw === "number" && Number.isFinite(seqRaw) && seqRaw >= 0
        ? Math.round(seqRaw)
        : null;
    const sessionId =
      typeof e.session_id === "string" && e.session_id.trim() !== ""
        ? e.session_id.slice(0, 128)
        : typeof e.userId === "string" && e.userId.trim() !== ""
          ? e.userId.slice(0, 128)
          : typeof e.user_id === "string" && e.user_id.trim() !== ""
            ? e.user_id.slice(0, 128)
            : null;

    rows.push({
      event_id: eventId,
      instance_id: instanceId,
      kind,
      payload: e,
      // Recorded per row: the drainer writes it onto the destination, and it
      // is the only evidence of WHERE a reported event came from once the
      // request is gone.
      origin: host,
      seq,
      session_id: sessionId,
    });
  }

  if (rows.length === 0) {
    return corsify(
      NextResponse.json({ accepted: 0, skipped }, { status: 202 }),
      origin,
    );
  }

  const { error } = await sb
    .from("event_inbox")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) {
    // We have NOT accepted it, so do not say 202. A 500 is what tells the
    // storefront's retry queue to hold the batch and send it again — which
    // is the whole reason that queue exists.
    console.error("[events] event_inbox insert failed:", error.message);
    return corsify(
      NextResponse.json({ error: "event_recording_failed" }, { status: 500 }),
      origin,
    );
  }

  return corsify(
    NextResponse.json({ accepted: rows.length, skipped }, { status: 202 }),
    origin,
  );
}
