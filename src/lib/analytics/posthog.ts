import { PostHog } from "posthog-node";

/**
 * Thin server-side PostHog forwarder (PostHog Analytics MVP, Prompt 1).
 *
 * Forwarding is OPTIONAL: when POSTHOG_API_KEY is unset the client is a no-op,
 * so the app runs unchanged in envs where analytics isn't wired. We never add
 * posthog-js to the storefront — capture is server-side only, from the RRE
 * endpoints we already own (see docs/design/posthog-analytics-mvp.md).
 *
 * Credentials (references only; set the real values in env):
 *   POSTHOG_API_KEY  — project capture key (PostHog → Settings → Project → API keys)
 *   POSTHOG_HOST     — https://us.i.posthog.com | https://eu.i.posthog.com
 */

let client: PostHog | null = null;
let initialized = false;

function getClient(): PostHog | null {
  if (initialized) return client;
  initialized = true;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    // Serverless: send promptly and don't rely on a flush timer we may never
    // reach. We flush() inline after each capture instead.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

export type PostHogEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

/**
 * Best-effort capture. No-ops when PostHog isn't configured, flushes inline so
 * the event actually leaves a serverless invocation, and swallows every error —
 * analytics must never break the request path. Invoke inside next/server
 * `after()` so it runs after the response is sent.
 */
export async function capturePostHog(e: PostHogEvent): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    c.capture({
      distinctId: e.distinctId,
      event: e.event,
      properties: e.properties,
    });
    await c.flush();
  } catch (err) {
    console.error(
      "[posthog] capture failed:",
      err instanceof Error ? err.message : err
    );
  }
}
