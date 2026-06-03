/**
 * PostHog forwarder smoke test (PostHog Analytics MVP).
 * Spec: docs/design/posthog-analytics-mvp.md
 *
 * Proves the REAL forwarder (src/lib/analytics/posthog.ts) + your project key
 * actually deliver to PostHog — independent of any RRE deploy. Sends three
 * events that mirror what the live endpoints emit, then exits.
 *
 * Run with the real key in env (NEVER paste the key in chat/commits):
 *   POSTHOG_API_KEY=phc_xxx POSTHOG_HOST=https://us.i.posthog.com \
 *     npx tsx scripts/test-posthog.ts
 * or, if you keep them in .env.local:
 *   npx tsx --env-file=.env.local scripts/test-posthog.ts
 *
 * Each send now reads PostHog's HTTP acknowledgement, so the test itself
 * reports accepted/rejected per event — you no longer have to go hunting in
 * the PostHog UI to know whether it worked. Exits non-zero if any event was
 * rejected.
 */

import { capturePostHog, type CaptureResult } from "../src/lib/analytics/posthog";

async function send(
  event: string,
  properties: Record<string, unknown>,
  distinctId: string
): Promise<boolean> {
  const r: CaptureResult = await capturePostHog({ distinctId, event, properties });
  if (r.ok) {
    console.log(`[smoke] ACCEPTED  ${event} (HTTP ${r.status})`);
    return true;
  }
  console.error(`[smoke] REJECTED  ${event}:`, r);
  return false;
}

async function main() {
  if (!process.env.POSTHOG_API_KEY) {
    console.error(
      "POSTHOG_API_KEY is not set — the forwarder is a no-op and nothing will be sent.\n" +
        "Set it in env (or .env.local) and re-run. Do not paste the key in chat."
    );
    process.exit(1);
  }

  const distinctId = `smoke-test-${Date.now()}`;
  console.log(
    `[smoke] host=${process.env.POSTHOG_HOST || "https://us.i.posthog.com (default)"}`
  );
  console.log(`[smoke] distinct_id=${distinctId}`);

  const results = [
    await send(
      "Search Performed",
      {
        query: "smoke test query",
        query_uid: "smoke-quid-1",
        total_hits: 3,
        user_id: distinctId,
        instance_id: 0,
        __smoke_test: true,
      },
      distinctId
    ),
    await send(
      "Product Clicked",
      {
        event_type: "click",
        query_uid: "smoke-quid-1",
        keyword: "smoke test query",
        position: 1,
        object_id: "smoke-prod-1",
        object_name: "Smoke Test Product",
        instance_id: 0,
        __smoke_test: true,
      },
      distinctId
    ),
    await send(
      "Product Added to Cart",
      {
        event_type: "conversion",
        query_uid: "smoke-quid-1",
        keyword: "smoke test query",
        object_id: "smoke-prod-1",
        object_name: "Smoke Test Product",
        instance_id: 0,
        __smoke_test: true,
      },
      distinctId
    ),
  ];

  const accepted = results.filter(Boolean).length;
  console.log(`\n[smoke] ${accepted}/${results.length} events acknowledged by PostHog.`);
  if (accepted !== results.length) {
    console.error("[smoke] At least one event was rejected — see above.");
    process.exit(1);
  }
  console.log(
    `[smoke] All accepted. Confirm in PostHog → Activity, distinct_id = "${distinctId}".`
  );
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
