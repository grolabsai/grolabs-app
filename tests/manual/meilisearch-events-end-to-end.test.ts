/**
 * End-to-end validation: can a tenant token signed from a `["search"]`-action
 * parent key actually POST to MeiliSearch `/events`?
 *
 * WHY THIS EXISTS
 * ---------------
 * A sibling test (meilisearch-events-action-validation) proved only that
 * MeiliSearch *creates* an API key with `actions: ["search"]`. It did NOT
 * prove that a tenant token signed from such a key is *authorised* by the
 * `/events` endpoint. That is a distinct authorization seam: key-creation
 * success does not imply event-submission success. The events token endpoint
 * (/api/v1/events/token, Plugin A v0.3.0) is unusable if this seam is closed,
 * so this test exercises the real POST against a live cluster.
 *
 * NO TEST FRAMEWORK IN THIS REPO
 * ------------------------------
 * This repo has no Vitest/Jest and the constraint forbids adding one. This
 * test uses Node's built-in test runner (`node:test`, zero dependencies) and
 * Node's native TypeScript support. It reuses the `meilisearch` SDK already
 * depended on by src/lib/search/meilisearch-client.ts plus `generateTenantToken`
 * from `meilisearch/token` — the exact signing path the real endpoint uses.
 *
 * HOW TO RUN MANUALLY
 * -------------------
 *   MEILISEARCH_HOST=... MEILISEARCH_MASTER_KEY=... \
 *     node --test src/lib/search/meilisearch-events-end-to-end.test.ts
 *
 * If MEILISEARCH_HOST / MEILISEARCH_MASTER_KEY are not set, the test SKIPS
 * (it does not fail) — it is an integration check against a real service, not
 * a unit test that runs on every PR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Meilisearch } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";

/**
 * Mirrors EVENTS_KEY_ACTION in src/lib/search/meilisearch-client.ts. Kept as a
 * literal so this test still validates the live cluster independently of the
 * constant's export status.
 */
const EVENTS_KEY_ACTION = "search";
const TEST_INDEX = "scout-events-test";

const host = process.env.MEILISEARCH_HOST;
const masterKey = process.env.MEILISEARCH_MASTER_KEY;
const haveCreds = Boolean(host && masterKey);

test(
  "tenant token from a search-action parent key is authorised by POST /events",
  {
    skip: haveCreds
      ? false
      : "MeiliSearch credentials not in env; skipping end-to-end validation.",
  },
  async () => {
    const client = new Meilisearch({ host: host!, apiKey: masterKey! });

    const keyName = `test-events-e2e-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    let createdUid: string | null = null;
    let createdIndex = false;

    try {
      // 1. Temporary parent key, actions: ["search"], short expiry.
      const parent = await client.createKey({
        name: keyName,
        description:
          "Ephemeral key validating that search-action tenant tokens can " +
          "POST /events. Auto-deleted.",
        actions: [EVENTS_KEY_ACTION],
        indexes: ["*"],
        expiresAt,
      });
      createdUid = parent.uid;
      assert.ok(parent.uid, "Key created but no uid returned by SDK");

      // 2. Sign a tenant token from that key — the real signing path.
      const tenantToken = await generateTenantToken({
        apiKey: parent.key,
        apiKeyUid: parent.uid,
        searchRules: { "*": {} },
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
      });

      // 3. Ensure the throwaway test index exists, seeded with one doc.
      try {
        await client.getIndex(TEST_INDEX);
      } catch {
        const task = await client.createIndex(TEST_INDEX, {
          primaryKey: "id",
        });
        await client.tasks.waitForTask(task.taskUid);
        const addTask = await client
          .index(TEST_INDEX)
          .addDocuments([{ id: "test-object-1", name: "Test Object" }]);
        await client.tasks.waitForTask(addTask.taskUid);
        createdIndex = true;
      }

      // 4. POST /events with the tenant token as the bearer credential.
      const res = await fetch(`${host!.replace(/\/+$/, "")}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tenantToken}`,
        },
        body: JSON.stringify({
          eventType: "click",
          eventName: "End-to-End Test Click",
          indexUid: TEST_INDEX,
          userId: "test-user-uuid",
          queryUid: "test-query-uid",
          objectId: "test-object-1",
          objectName: "Test Object",
          position: 0,
        }),
      });

      // 5. Three outcomes.
      if (res.status === 200 || res.status === 201 || res.status === 204) {
        // (a) SUCCESS — search-action tokens DO authorize /events.
        // The live cluster returns 201 Created in practice (verified
        // 2026-05-18); 200/204 are accepted defensively in case the
        // endpoint's success status changes across MeiliSearch versions.
        assert.ok(true);
        return;
      }

      if (res.status === 401 || res.status === 403) {
        // (b) Rejected — the fallback is insufficient.
        let body = "";
        try {
          body = await res.text();
        } catch {
          /* ignore */
        }
        assert.fail(
          "MeiliSearch rejected tenant token from search-action parent key " +
            "for /events POST. The fallback is insufficient — investigate " +
            "alternate action constants or token signing approach. " +
            `(HTTP ${res.status})${body ? ` body: ${body}` : ""}`
        );
      }

      // (c) Any other error — surface it for debugging.
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      assert.fail(
        `Unexpected response from POST /events: HTTP ${res.status}` +
          `${body ? ` body: ${body}` : ""}`
      );
    } finally {
      // Best-effort cleanup. A failed delete must not fail the test.
      if (createdIndex) {
        try {
          await client.deleteIndex(TEST_INDEX);
        } catch (e) {
          const d = e instanceof Error ? e.message : String(e);
          console.warn(
            `[meilisearch-events-end-to-end] cleanup: failed to delete index ` +
              `${TEST_INDEX}: ${d}`
          );
        }
      }
      if (createdUid) {
        try {
          await client.deleteKey(createdUid);
        } catch (e) {
          const d = e instanceof Error ? e.message : String(e);
          console.warn(
            `[meilisearch-events-end-to-end] cleanup: failed to delete key ` +
              `${keyName} (${createdUid}): ${d}`
          );
        }
      }
    }
  }
);
