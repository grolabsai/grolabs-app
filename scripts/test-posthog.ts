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
 * Then look in PostHog → Activity (live events) for distinct_id
 * "smoke-test-<timestamp>" — you should see all three within ~30s.
 */

import { capturePostHog } from "../src/lib/analytics/posthog";

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

  await capturePostHog({
    distinctId,
    event: "Search Performed",
    properties: {
      query: "smoke test query",
      query_uid: "smoke-quid-1",
      total_hits: 3,
      user_id: distinctId,
      instance_id: 0,
      __smoke_test: true,
    },
  });
  console.log("[smoke] sent: Search Performed");

  await capturePostHog({
    distinctId,
    event: "Product Clicked",
    properties: {
      event_type: "click",
      query_uid: "smoke-quid-1",
      keyword: "smoke test query",
      position: 1,
      object_id: "smoke-prod-1",
      object_name: "Smoke Test Product",
      instance_id: 0,
      __smoke_test: true,
    },
  });
  console.log("[smoke] sent: Product Clicked");

  await capturePostHog({
    distinctId,
    event: "Product Added to Cart",
    properties: {
      event_type: "conversion",
      query_uid: "smoke-quid-1",
      keyword: "smoke test query",
      object_id: "smoke-prod-1",
      object_name: "Smoke Test Product",
      instance_id: 0,
      __smoke_test: true,
    },
  });
  console.log("[smoke] sent: Product Added to Cart");

  console.log(
    `\n[smoke] Done. In PostHog → Activity, filter distinct_id = "${distinctId}".\n` +
      "[smoke] If all three appear, the forwarder + key work; any gap is the deploy/env, not the code."
  );
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
