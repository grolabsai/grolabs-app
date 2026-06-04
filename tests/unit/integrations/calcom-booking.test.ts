import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

/**
 * Automated coverage for the Cal.com → Klaviyo webhook receiver
 * (src/app/api/v1/integrations/cal/booking/route.ts).
 *
 * This is the CI-safe counterpart to scripts/calcom-webhook-smoke.mjs: it feeds
 * a correctly-signed payload for EVERY booking-lifecycle trigger through the
 * real route handler and asserts that each one is mapped to the right Klaviyo
 * metric AND recorded to backend_operation. Klaviyo and the observability
 * recorder are mocked, so nothing leaves the process — no real Klaviyo events,
 * no DB writes. The live script is for hitting a deployed URL on purpose.
 *
 * See docs/design/klaviyo-assessment-call-events.md → "Test scenarios".
 */

// Mock the Klaviyo client but keep the REAL error classes — the route does
// `instanceof KlaviyoConfigError / KlaviyoApiError` branching.
vi.mock("@/lib/integrations/klaviyo/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integrations/klaviyo/client")>();
  return { ...actual, trackEvent: vi.fn() };
});

// Mock the durable recorder so the suite never touches Supabase. We assert on
// the calls instead.
vi.mock("@/lib/observability/backend-operation", () => ({
  recordBackendOperation: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/v1/integrations/cal/booking/route";
import {
  trackEvent,
  KlaviyoApiError,
  KlaviyoConfigError,
} from "@/lib/integrations/klaviyo/client";
import { recordBackendOperation } from "@/lib/observability/backend-operation";

const trackEventMock = vi.mocked(trackEvent);
const recordMock = vi.mocked(recordBackendOperation);

const TEST_SECRET = "test_webhook_secret_0123456789abcdef";
const ENDPOINT = "https://test.local/api/v1/integrations/cal/booking";

/** The trigger → metric contract. Intentionally duplicated from the route so
 * this test acts as an independent spec: if the route's map drifts, this fails. */
const EXPECTED_METRIC: Record<string, string> = {
  BOOKING_REQUESTED: "Booking Requested",
  BOOKING_CREATED: "Booking Created",
  BOOKING_RESCHEDULED: "Booking Rescheduled",
  BOOKING_CANCELLED: "Booking Cancelled",
  BOOKING_REJECTED: "Booking Rejected",
};

function sign(rawBody: string, secret = TEST_SECRET): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function bookingBody(
  trigger: string,
  opts: { email?: string | null; uid?: string } = {},
): string {
  const { email = "smoke@grolabs.test", uid = `uid_${trigger}` } = opts;
  return JSON.stringify({
    triggerEvent: trigger,
    createdAt: "2026-06-04T00:00:00.000Z",
    payload: {
      uid,
      type: "15min",
      title: "Assessment Call",
      startTime: "2026-06-05T10:00:00.000Z",
      endTime: "2026-06-05T10:15:00.000Z",
      attendees: email
        ? [{ email, name: "Test Prospect", timeZone: "America/Mexico_City" }]
        : [],
    },
  });
}

/** Build a Request the way the route reads it: raw text body + signature header. */
function makeRequest(
  rawBody: string,
  opts: { sign?: boolean; secret?: string; signature?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== undefined) {
    headers["x-cal-signature-256"] = opts.signature;
  } else if (opts.sign !== false) {
    headers["x-cal-signature-256"] = sign(rawBody, opts.secret ?? TEST_SECRET);
  }
  return new Request(ENDPOINT, { method: "POST", headers, body: rawBody });
}

beforeEach(() => {
  process.env.CALCOM_WEBHOOK_SECRET = TEST_SECRET;
  trackEventMock.mockReset();
  trackEventMock.mockResolvedValue(undefined);
  recordMock.mockReset();
  recordMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cal.com webhook → Klaviyo: every lifecycle trigger is mapped + recorded", () => {
  for (const [trigger, metric] of Object.entries(EXPECTED_METRIC)) {
    it(`${trigger} → "${metric}" event, recorded succeeded`, async () => {
      const raw = bookingBody(trigger);
      const res = await POST(makeRequest(raw));

      // Accepted
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ recorded: true });

      // Mapped to the correct metric, with per-lifecycle idempotency key.
      expect(trackEventMock).toHaveBeenCalledTimes(1);
      const arg = trackEventMock.mock.calls[0][0];
      expect(arg.metricName).toBe(metric);
      expect(arg.profile.email).toBe("smoke@grolabs.test");
      expect(arg.uniqueId).toBe(`${trigger}:uid_${trigger}`);
      expect(arg.properties?.trigger).toBe(trigger);

      // Recorded as a succeeded klaviyo_event.
      const success = recordMock.mock.calls.find(
        (c) => c[0].operationType === "klaviyo_event",
      );
      expect(success, "expected a klaviyo_event row").toBeTruthy();
      expect(success![0].status).toBe("succeeded");
      expect(success![0].targetId).toBe(`uid_${trigger}`);
    });
  }
});

describe("Cal.com webhook → guard rails (no silent drops)", () => {
  it("rejects a bad signature with 401 and does not call Klaviyo", async () => {
    const raw = bookingBody("BOOKING_CREATED");
    const res = await POST(makeRequest(raw, { signature: "deadbeef" }));

    expect(res.status).toBe(401);
    expect(trackEventMock).not.toHaveBeenCalled();
    const failure = recordMock.mock.calls.find(
      (c) => c[0].errorMessage === "invalid_signature",
    );
    expect(failure, "expected an invalid_signature row").toBeTruthy();
    expect(failure![0].status).toBe("failed");
  });

  it("rejects a missing signature header with 401", async () => {
    const raw = bookingBody("BOOKING_CREATED");
    const res = await POST(makeRequest(raw, { sign: false }));
    expect(res.status).toBe(401);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the secret is not configured", async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET;
    const raw = bookingBody("BOOKING_CREATED");
    const res = await POST(makeRequest(raw, { sign: false }));
    expect(res.status).toBe(500);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("acknowledges an unmapped trigger (PING) and records ignored_trigger", async () => {
    const raw = JSON.stringify({ triggerEvent: "PING", payload: {} });
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ignored: "PING" });
    expect(trackEventMock).not.toHaveBeenCalled();
    const ignored = recordMock.mock.calls.find(
      (c) => (c[0].payloadSummary as { ignored_trigger?: string } | null)?.ignored_trigger === "PING",
    );
    expect(ignored, "expected an ignored_trigger row").toBeTruthy();
    expect(ignored![0].status).toBe("succeeded");
  });

  it("acknowledges a mapped trigger with no attendee email, records the gap", async () => {
    const raw = bookingBody("BOOKING_CREATED", { email: null });
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(200);
    expect(trackEventMock).not.toHaveBeenCalled();
    const failure = recordMock.mock.calls.find(
      (c) => c[0].errorMessage === "no_attendee_email",
    );
    expect(failure, "expected a no_attendee_email row").toBeTruthy();
  });
});

describe("Cal.com webhook → Klaviyo failures surface durably", () => {
  it("returns 502 and records failed when Klaviyo errors (so Cal.com retries)", async () => {
    trackEventMock.mockRejectedValueOnce(
      new KlaviyoApiError("boom", 429, { detail: "rate limited" }),
    );
    const raw = bookingBody("BOOKING_CREATED");
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(502);
    const failure = recordMock.mock.calls.find(
      (c) => c[0].operationType === "klaviyo_event" && c[0].status === "failed",
    );
    expect(failure, "expected a failed klaviyo_event row").toBeTruthy();
    expect(String(failure![0].errorMessage)).toContain("Klaviyo create-event failed");
  });

  it("returns 500 when the Klaviyo key is missing", async () => {
    trackEventMock.mockRejectedValueOnce(
      new KlaviyoConfigError("KLAVIYO_PRIVATE_API_KEY is not set in the environment."),
    );
    const raw = bookingBody("BOOKING_CREATED");
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(500);
    const failure = recordMock.mock.calls.find(
      (c) => c[0].operationType === "klaviyo_event" && c[0].status === "failed",
    );
    expect(failure, "expected a failed klaviyo_event row").toBeTruthy();
  });
});
