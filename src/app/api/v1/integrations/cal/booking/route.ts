import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { trackEvent, KlaviyoConfigError, KlaviyoApiError } from "@/lib/integrations/klaviyo/client";
import { recordBackendOperation } from "@/lib/observability/backend-operation";

/**
 * POST /api/v1/integrations/cal/booking
 *
 * Cal.com webhook receiver for GroLabs's assessment-call funnel. Per
 * docs/design/klaviyo-assessment-call-events.md.
 *
 * Flow: Cal.com emits a booking-lifecycle event server-to-server → we verify
 * the HMAC-SHA256 signature → map the trigger to a past-tense Klaviyo metric
 * (see TRIGGER_TO_METRIC) → forward to GroLabs's corporate Klaviyo account
 * (upserts the profile, create-if-absent). One booking produces several events
 * across its life (requested → created → rescheduled → cancelled / rejected).
 *
 * Trust model: public endpoint (Cal.com is unauthenticated server-to-server).
 * The X-Cal-Signature-256 HMAC over the raw body, keyed by CALCOM_WEBHOOK_SECRET,
 * is the only authorization. No Supabase session, no instance_id — this is
 * GroLabs corporate, not a per-merchant integration.
 *
 * Observability: every failure (and the successful Klaviyo write) is recorded
 * to the `backend_operation` table so problems are durable + queryable, not
 * just ephemeral console output. Alerting over status='failed' is planned
 * separately. NOTE: this is a public endpoint, so logging inbound-validation
 * failures (bad signature) lets an attacker spam rows — Cal.com webhook volume
 * is low so this is acceptable for now; add rate-limiting if it becomes a
 * problem (see search_rate_limit / record_diagnostic_request for the pattern).
 *
 * Status contract:
 *   - 401 on bad/missing signature (do NOT forward to Klaviyo)
 *   - 200 on success or on a verified trigger we don't map (recorded as an
 *     `ignored_trigger` row so unmapped/renamed triggers are visible, not silent)
 *   - 5xx on Klaviyo failure, so Cal.com retries (the unique_id guard keeps
 *     retries idempotent)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cal.com booking-lifecycle trigger → GroLabs Klaviyo metric. Names follow the
 * GroLabs standard: past tense. The trigger strings are Cal.com's
 * `WebhookTriggerEvents` enum values (note: the API emits `BOOKING_CANCELLED`
 * with the double-L spelling, even though the dashboard label reads "canceled").
 * A trigger absent from this map is acknowledged but not forwarded — and a
 * durable `ignored_trigger` row is written so a renamed/unexpected trigger
 * surfaces instead of vanishing.
 */
const TRIGGER_TO_METRIC: Record<string, string> = {
  BOOKING_REQUESTED: "Booking Requested",
  BOOKING_CREATED: "Booking Created",
  BOOKING_RESCHEDULED: "Booking Rescheduled",
  BOOKING_CANCELLED: "Booking Cancelled",
  BOOKING_REJECTED: "Booking Rejected",
};

/** GroLabs corporate. The assessment-call funnel is instance-agnostic; the
 * template instance (0) is the canonical home for GroLabs's own operations. */
const GROLABS_INSTANCE_ID = 0;

const OP_INBOUND = "calcom_webhook_inbound";
const OP_KLAVIYO = "klaviyo_event";

interface CalAttendee {
  email?: string;
  name?: string;
  timeZone?: string;
}

interface CalBookingPayload {
  uid?: string;
  type?: string;
  title?: string;
  eventTitle?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  attendees?: CalAttendee[];
  responses?: Record<string, unknown>;
  metadata?: { videoCallUrl?: string } & Record<string, unknown>;
  // Lifecycle-specific fields, present only on the relevant trigger.
  cancellationReason?: string; // BOOKING_CANCELLED
  rejectionReason?: string; // BOOKING_REJECTED
  rescheduleUid?: string; // BOOKING_RESCHEDULED — the prior booking's uid
  rescheduleStartTime?: string; // BOOKING_RESCHEDULED
  rescheduleEndTime?: string; // BOOKING_RESCHEDULED
  status?: string; // e.g. ACCEPTED / PENDING / CANCELLED
}

interface CalWebhookBody {
  triggerEvent?: string;
  createdAt?: string;
  payload?: CalBookingPayload;
}

/** Verify Cal.com's hex HMAC-SHA256 over the raw body, constant-time. */
function signatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function splitName(name?: string): { firstName?: string; lastName?: string } {
  const trimmed = name?.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Durable failure record. Best-effort: never throws (the helper swallows). */
async function recordFailure(
  operationType: string,
  errorMessage: string,
  extra?: {
    targetId?: string | null;
    payloadSummary?: Record<string, unknown> | null;
    responsePayload?: unknown;
    startedAtMs?: number;
  },
): Promise<void> {
  await recordBackendOperation({
    instanceId: GROLABS_INSTANCE_ID,
    operationType,
    status: "failed",
    errorMessage,
    targetId: extra?.targetId ?? null,
    payloadSummary: extra?.payloadSummary ?? null,
    responsePayload: extra?.responsePayload,
    startedAtMs: extra?.startedAtMs,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfiguration, not a client error. Don't process unsigned traffic.
    console.error("[cal-webhook] CALCOM_WEBHOOK_SECRET is not set in this environment");
    await recordFailure(OP_INBOUND, "CALCOM_WEBHOOK_SECRET not set in environment");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-cal-signature-256");
  if (!signatureValid(rawBody, signature, secret)) {
    console.warn(
      `[cal-webhook] signature rejected — header present: ${signature !== null}, body bytes: ${rawBody.length}`,
    );
    await recordFailure(OP_INBOUND, "invalid_signature", {
      payloadSummary: { signature_header_present: signature !== null, body_bytes: rawBody.length },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: CalWebhookBody;
  try {
    body = JSON.parse(rawBody) as CalWebhookBody;
  } catch {
    console.warn("[cal-webhook] body was not valid JSON");
    await recordFailure(OP_INBOUND, "invalid_json");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const trigger = body.triggerEvent ?? "";
  console.log(`[cal-webhook] verified delivery — trigger: ${trigger || "(none)"}`);

  const metricName = TRIGGER_TO_METRIC[trigger];
  if (!metricName) {
    // Verified, but a trigger we don't forward (e.g. a Ping test, or a trigger
    // Cal.com added/renamed). Record it so the gap is visible — a silent 200
    // here is exactly how a mis-subscribed or renamed trigger would hide.
    console.log(`[cal-webhook] no metric mapped for trigger "${trigger || "(none)"}" — acknowledging`);
    await recordBackendOperation({
      instanceId: GROLABS_INSTANCE_ID,
      operationType: OP_INBOUND,
      status: "succeeded",
      payloadSummary: { ignored_trigger: trigger || null },
    });
    return NextResponse.json({ ignored: trigger || null }, { status: 200 });
  }

  const p = body.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const email = attendee.email;
  if (!email) {
    // No identifier — nothing to attach in Klaviyo. Acknowledge so Cal.com
    // doesn't retry a payload that will never succeed.
    console.warn(
      `[cal-webhook] ${trigger} had no attendee email — payload keys: ${Object.keys(p).join(",")}, attendees: ${p.attendees?.length ?? 0}`,
    );
    await recordFailure(OP_INBOUND, "no_attendee_email", {
      targetId: p.uid ?? null,
      payloadSummary: { trigger, payload_keys: Object.keys(p), attendee_count: p.attendees?.length ?? 0 },
    });
    return NextResponse.json({ error: "No attendee email" }, { status: 200 });
  }

  const { firstName, lastName } = splitName(attendee.name);
  const startedAtMs = Date.now();
  const opSummary = { trigger, metric: metricName, email, event_type: p.type ?? p.eventTitle ?? p.title };

  try {
    await trackEvent({
      metricName,
      profile: {
        email,
        firstName,
        lastName,
      },
      properties: {
        trigger,
        booking_uid: p.uid,
        event_type: p.type ?? p.eventTitle ?? p.title,
        scheduled_start: p.startTime,
        scheduled_end: p.endTime,
        timezone: attendee.timeZone,
        meeting_url: p.metadata?.videoCallUrl ?? p.location,
        booking_status: p.status,
        cancellation_reason: p.cancellationReason,
        rejection_reason: p.rejectionReason,
        reschedule_from_uid: p.rescheduleUid,
        source: "cal.com",
        responses: p.responses,
      },
      time: body.createdAt ?? p.startTime,
      // Scope idempotency to trigger + booking so retries of the SAME lifecycle
      // event dedupe, while distinct events on one booking (created, then
      // rescheduled, then cancelled) are each recorded.
      uniqueId: p.uid ? `${trigger}:${p.uid}` : undefined,
    });
  } catch (err) {
    if (err instanceof KlaviyoConfigError) {
      console.error("[cal-webhook] KLAVIYO_PRIVATE_API_KEY is not set in this environment");
      await recordFailure(OP_KLAVIYO, "KLAVIYO_PRIVATE_API_KEY not set in environment", {
        targetId: p.uid ?? null,
        payloadSummary: opSummary,
        startedAtMs,
      });
      return NextResponse.json({ error: "Klaviyo not configured" }, { status: 500 });
    }
    // Transient/upstream failure — 5xx so Cal.com retries (idempotent via uid).
    const detail =
      err instanceof KlaviyoApiError
        ? `status ${err.status} body ${JSON.stringify(err.body)}`
        : String(err);
    console.error(`[cal-webhook] Klaviyo create-event failed for uid ${p.uid}:`, detail);
    await recordFailure(OP_KLAVIYO, `Klaviyo create-event failed: ${detail}`, {
      targetId: p.uid ?? null,
      payloadSummary: opSummary,
      responsePayload: err instanceof KlaviyoApiError ? err.body : null,
      startedAtMs,
    });
    return NextResponse.json({ error: "Failed to record event" }, { status: 502 });
  }

  await recordBackendOperation({
    instanceId: GROLABS_INSTANCE_ID,
    operationType: OP_KLAVIYO,
    status: "succeeded",
    targetId: p.uid ?? null,
    payloadSummary: opSummary,
    startedAtMs,
  });
  console.log(`[cal-webhook] recorded "${metricName}" for ${email} (uid ${p.uid})`);
  return NextResponse.json({ recorded: true }, { status: 200 });
}
