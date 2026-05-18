/**
 * Live validation of the MeiliSearch "events.add" action constant.
 *
 * WHY THIS EXISTS
 * ---------------
 * The events token endpoint (/api/v1/events/token, Plugin A v0.3.0) depends on
 * a MeiliSearch parent API key created with `actions: ["events.add"]`. That
 * action string was written into the implementation but never validated against
 * a live MeiliSearch cluster. If the constant is wrong, key creation fails at
 * runtime with `invalid_api_key_actions`. This test catches that ahead of time
 * by attempting the real key creation against the configured cluster.
 *
 * NO TEST FRAMEWORK IN THIS REPO
 * ------------------------------
 * This repo has no Vitest/Jest and the constraint forbids adding one. This test
 * uses Node's built-in test runner (`node:test`, zero dependencies) and Node's
 * native TypeScript support. It reuses the `meilisearch` SDK already depended on
 * by src/lib/search/meilisearch-client.ts — no new client/dependency.
 *
 * HOW TO RUN MANUALLY
 * -------------------
 *   MEILISEARCH_HOST=... MEILISEARCH_MASTER_KEY=... \
 *     node --test src/lib/search/meilisearch-events-action-validation.test.ts
 *
 * If MEILISEARCH_HOST / MEILISEARCH_MASTER_KEY are not set, the test SKIPS
 * (it does not fail) — it is an integration check against a real service, not a
 * unit test that runs on every PR. Wire it only into a CI job that has those
 * secrets available; this repo currently has no .github/workflows to register.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Meilisearch, MeilisearchApiError } from "meilisearch";

/**
 * The action under validation. Mirrors the EVENTS_KEY_ACTION constant used by
 * the events token implementation in src/lib/search/meilisearch-client.ts.
 * Kept as a literal here so the test still validates the live cluster even if
 * the constant is not yet exported.
 */
const EVENTS_KEY_ACTION = "events.add";

const host = process.env.MEILISEARCH_HOST;
const masterKey = process.env.MEILISEARCH_MASTER_KEY;
const haveCreds = Boolean(host && masterKey);

test(
  "MeiliSearch accepts the 'events.add' action for API key creation",
  {
    skip: haveCreds
      ? false
      : "MeiliSearch credentials not in env; skipping live validation.",
  },
  async () => {
    const client = new Meilisearch({ host: host!, apiKey: masterKey! });

    const keyName = `test-events-action-validation-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes out

    let createdUid: string | null = null;
    try {
      let created;
      try {
        created = await client.createKey({
          name: keyName,
          description:
            "Ephemeral key to validate the 'events.add' action. Auto-deleted.",
          actions: [EVENTS_KEY_ACTION],
          indexes: ["*"],
          expiresAt,
        });
      } catch (err) {
        const code =
          err instanceof MeilisearchApiError
            ? (err.cause as { code?: string } | undefined)?.code ??
              // SDK shapes the API error body differently across versions;
              // fall back to a message substring match.
              (/invalid_api_key_actions/.test(err.message)
                ? "invalid_api_key_actions"
                : undefined)
            : undefined;

        if (code === "invalid_api_key_actions") {
          assert.fail(
            "MeiliSearch rejected 'events.add' as an invalid action. " +
              "Update EVENTS_KEY_ACTION constant in src/lib/search/meilisearch-client.ts. " +
              "Per MeiliSearch docs, event submission may work with the 'search' " +
              "action instead — try that as the fallback."
          );
        }

        // Outcome (c): any other error — surface it for debugging.
        const detail = err instanceof Error ? err.message : String(err);
        assert.fail(
          `Unexpected error creating the validation key (not an invalid-action ` +
            `rejection): ${detail}`
        );
        return; // unreachable; assert.fail throws
      }

      // Outcome (a): success — the action is valid.
      createdUid = created.uid;
      assert.ok(
        created.uid,
        "Key created but no uid returned by MeiliSearch SDK"
      );
    } finally {
      // Best-effort cleanup. The test's purpose is action validation, not
      // cleanup robustness — a failed delete must not fail the test.
      if (createdUid) {
        try {
          await client.deleteKey(createdUid);
        } catch (cleanupErr) {
          const detail =
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr);
          console.warn(
            `[meilisearch-events-action-validation] cleanup warning: failed ` +
              `to delete test key ${keyName} (${createdUid}): ${detail}`
          );
        }
      }
    }
  }
);
