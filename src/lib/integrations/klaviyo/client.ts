/**
 * The single place in GroLabs's codebase that talks to Klaviyo.
 *
 * Per docs/design/klaviyo-assessment-call-events.md. This is GroLabs's OWN
 * corporate Klaviyo account (the sales funnel for GroLabs selling to
 * merchants) — NOT a per-instance merchant integration. The credential is a
 * global env var, not the Vault/integrations_config pattern used by
 * Algolia/GA4.
 *
 * Mirrors the ga4 client pattern: typed errors, never logs the key, callable
 * from server-only code.
 *
 * Env vars:
 *   KLAVIYO_PRIVATE_API_KEY — private API key, full server scope (server-only)
 *
 * Endpoints used:
 *   - https://a.klaviyo.com/api/events/   (Create Event — upserts profile + event)
 */

// ── Config ───────────────────────────────────────────────────────────────────

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";

/**
 * Klaviyo pins its API behaviour to a dated revision sent on every request.
 * Bump deliberately after reading the changelog — never silently.
 * https://developers.klaviyo.com/en/reference/api_overview#api-versioning
 */
const KLAVIYO_REVISION = "2024-10-15";

function requireKey(): string {
  const v = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!v) {
    throw new KlaviyoConfigError(
      "KLAVIYO_PRIVATE_API_KEY is not set in the environment.",
    );
  }
  return v;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class KlaviyoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KlaviyoConfigError";
  }
}

export class KlaviyoApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "KlaviyoApiError";
    this.status = status;
    this.body = body;
  }
}

// ── Create Event ───────────────────────────────────────────────────────────

export interface KlaviyoProfileInput {
  /** Required identifier. Klaviyo upserts the profile from this. */
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

export interface TrackEventInput {
  /** Metric name. GroLabs standard: past tense, e.g. "Booked Assessment Call". */
  metricName: string;
  profile: KlaviyoProfileInput;
  /** Free-form event properties. */
  properties?: Record<string, unknown>;
  /** When the event occurred (ISO 8601). Defaults to now on Klaviyo's side. */
  time?: string;
  /**
   * Idempotency key. Re-POSTing the same unique_id for the same profile+metric
   * is discarded by Klaviyo, so webhook retries don't double-count. Pass the
   * upstream booking id here.
   */
  uniqueId?: string;
  /** Optional numeric value (e.g. revenue) for the event. */
  value?: number;
}

/**
 * Create an event on GroLabs's Klaviyo account. One call both upserts the
 * profile (create-if-absent, keyed by email) and records the event. A profile
 * may accumulate many events, including many of the same metric.
 *
 * Throws KlaviyoConfigError if the key is missing, KlaviyoApiError on a
 * non-2xx response or network failure. Never logs the API key.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  const key = requireKey();

  const profileAttributes: Record<string, unknown> = {
    email: input.profile.email,
  };
  if (input.profile.firstName) profileAttributes.first_name = input.profile.firstName;
  if (input.profile.lastName) profileAttributes.last_name = input.profile.lastName;
  if (input.profile.phoneNumber) profileAttributes.phone_number = input.profile.phoneNumber;

  const attributes: Record<string, unknown> = {
    metric: { data: { type: "metric", attributes: { name: input.metricName } } },
    profile: { data: { type: "profile", attributes: profileAttributes } },
  };
  if (input.properties) attributes.properties = input.properties;
  if (input.time) attributes.time = input.time;
  if (input.uniqueId) attributes.unique_id = input.uniqueId;
  if (typeof input.value === "number") attributes.value = input.value;

  const payload = { data: { type: "event", attributes } };

  let res: Response;
  try {
    res = await fetch(`${KLAVIYO_API_BASE}/events/`, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: KLAVIYO_REVISION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new KlaviyoApiError(`Network error creating event: ${String(err)}`, 0);
  }

  // Create Event returns 202 Accepted with an empty body on success.
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new KlaviyoApiError(
      `Klaviyo create-event failed (${res.status})`,
      res.status,
      body,
    );
  }
}
