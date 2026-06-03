/**
 * Server-side PostHog forwarder (PostHog Analytics MVP).
 *
 * Forwarding is OPTIONAL: when POSTHOG_API_KEY is unset this is a no-op, so the
 * app runs unchanged in envs where analytics isn't wired. We never add
 * posthog-js to the storefront — capture is server-side only, from the RRE
 * endpoints we already own (see docs/design/posthog-analytics-mvp.md).
 *
 * Why a direct fetch instead of posthog-node's capture()/flush():
 *   posthog-node batches and resolves flush() whether or not PostHog actually
 *   accepted the event — the transport outcome is swallowed, so a caller can
 *   never tell a delivered event from a dropped one. We POST straight to
 *   PostHog's capture endpoint and read the HTTP status + `{status:1}` body,
 *   returning a definitive accepted/rejected result the caller can log. This
 *   does NOT buffer or retry: a rejected event is logged and dropped (no
 *   server-side hold-and-resend), which is acceptable for an analytics path.
 *
 * Credentials (references only; set the real values in env):
 *   POSTHOG_API_KEY  — project capture key (PostHog → Settings → Project → API keys)
 *   POSTHOG_HOST     — https://us.i.posthog.com | https://eu.i.posthog.com
 */

export type PostHogEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

export type CaptureResult =
  | { ok: true; status: number }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "http_error"; status: number; body: string }
  | { ok: false; reason: "exception"; error: string };

function host(): string {
  return (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
}

/**
 * Capture one event and return PostHog's acknowledgement. No-ops (returns
 * not_configured) when POSTHOG_API_KEY is unset. Never throws — every failure
 * path is a structured result. Invoke inside next/server `after()` so it runs
 * after the response is sent; the returned result lands in server logs.
 */
export async function capturePostHog(e: PostHogEvent): Promise<CaptureResult> {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const payload = {
    api_key: apiKey,
    event: e.event,
    distinct_id: e.distinctId,
    properties: e.properties ?? {},
    timestamp: new Date().toISOString(),
  };

  let result: CaptureResult;
  try {
    const res = await fetch(`${host()}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    // PostHog returns 200 with {"status":1} on accept. Treat any 2xx whose
    // body doesn't explicitly report status:0 as accepted; everything else is
    // a rejection we can see.
    let accepted = res.ok;
    if (res.ok && text) {
      try {
        const parsed = JSON.parse(text) as { status?: number };
        if (parsed && parsed.status === 0) accepted = false;
      } catch {
        // Non-JSON 2xx body — trust the HTTP status.
      }
    }

    result = accepted
      ? { ok: true, status: res.status }
      : { ok: false, reason: "http_error", status: res.status, body: text.slice(0, 512) };
  } catch (err) {
    result = { ok: false, reason: "exception", error: err instanceof Error ? err.message : String(err) };
  }

  if (result.ok) {
    console.log(`[posthog] "${e.event}" captured (HTTP ${result.status})`);
  } else {
    console.error(`[posthog] "${e.event}" not captured:`, result);
  }
  return result;
}
