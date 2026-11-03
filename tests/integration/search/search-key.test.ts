/**
 * Permanent per-instance storefront search keys.
 *
 * Per docs/design/direct-meilisearch-search.md Phase 1 step 6. These are the
 * guarantees the direct-search design rests on, so they are asserted against
 * real Meilisearch rather than a mock:
 *
 *   - provisioning is idempotent (safe to call from a page render)
 *   - the key is scoped to exactly one index, which IS the tenant boundary
 *     now that nothing injects an instance_id filter on the storefront's behalf
 *   - the key authorizes its own index and is refused on any other
 *   - revocation actually stops search, and is recorded
 *   - re-issuing after a revocation produces a different key and leaves the
 *     revocation in the history
 *
 * Runs against the reserved test instance (99999) and cleans up after itself:
 * every key it mints is deleted upstream and every row removed, so a rerun
 * starts from zero.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deleteKeyByUid,
  describeKeyByUid,
  ensureIndex,
  meilisearchHost,
  searchKeyNameFor,
} from "@/lib/search/meilisearch-client";
import {
  getLiveSearchKey,
  getOrCreateInstanceSearchKey,
  getSearchKeyStatus,
  revokeInstanceSearchKey,
} from "@/lib/search/search-key";
import { indexUidFor } from "@/lib/search/types";
import { assertEnvOrSkip } from "./harness";
import { TEST_INSTANCE_ID } from "./fixtures";

const OTHER_INDEX = indexUidFor(0); // the template instance's index — not ours

/** Delete every key and row this instance has, upstream and locally. */
async function purge(): Promise<void> {
  const sb = createServiceRoleClient();
  const { data } = await sb
    .from("search_key")
    .select("key_uid")
    .eq("instance_id", TEST_INSTANCE_ID);
  for (const row of (data ?? []) as { key_uid: string }[]) {
    await deleteKeyByUid(row.key_uid).catch(() => {});
  }
  await sb.from("search_key").delete().eq("instance_id", TEST_INSTANCE_ID);
}

/** Search an index directly with a storefront key, exactly as the browser will. */
async function searchStatusWithKey(key: string, indexUid: string): Promise<number> {
  const res = await fetch(
    `${meilisearchHost().replace(/\/+$/, "")}/indexes/${indexUid}/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ q: "", limit: 1 }),
    }
  );
  return res.status;
}

beforeAll(async () => {
  assertEnvOrSkip();
  await ensureIndex(TEST_INSTANCE_ID);
  await purge();
}, 60_000);

afterAll(async () => {
  await purge();
}, 60_000);

describe("storefront search key", () => {
  it("provisions once and is idempotent thereafter", async () => {
    const first = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    const second = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);

    expect(second.keyUid).toBe(first.keyUid);
    expect(second.keyValue).toBe(first.keyValue);
    expect(first.keyName).toBe(searchKeyNameFor(TEST_INSTANCE_ID));
    expect(first.revokedAt).toBeNull();

    // The partial unique index is what makes this safe under concurrency.
    const sb = createServiceRoleClient();
    const { data } = await sb
      .from("search_key")
      .select("search_key_id")
      .eq("instance_id", TEST_INSTANCE_ID)
      .is("revoked_at", null);
    expect(data).toHaveLength(1);
  });

  it("is scoped to one index and search-only", async () => {
    const key = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    const upstream = await describeKeyByUid(key.keyUid);

    expect(upstream).not.toBeNull();
    expect(upstream!.actions).toEqual(["search"]);
    expect(upstream!.indexes).toEqual([indexUidFor(TEST_INSTANCE_ID)]);
  });

  it("authorizes its own index and is refused on another instance's", async () => {
    const key = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);

    expect(await searchStatusWithKey(key.keyValue, indexUidFor(TEST_INSTANCE_ID))).toBe(
      200
    );
    // The whole tenant boundary in direct mode. If this ever returns 200, one
    // merchant's storefront can read another's catalog.
    expect(await searchStatusWithKey(key.keyValue, OTHER_INDEX)).toBe(403);
  });

  it("reports live status verified against Meilisearch", async () => {
    await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    const status = await getSearchKeyStatus(TEST_INSTANCE_ID);

    expect(status.record).not.toBeNull();
    expect(status.liveUpstream).toBe(true);
    expect(status.revokedOutOfBand).toBe(false);
    expect(status.indexUid).toBe(indexUidFor(TEST_INSTANCE_ID));
  });

  it("revocation stops search, and is recorded", async () => {
    const key = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    expect(await searchStatusWithKey(key.keyValue, indexUidFor(TEST_INSTANCE_ID))).toBe(
      200
    );

    const revoked = await revokeInstanceSearchKey(TEST_INSTANCE_ID);
    expect(revoked).toBe(true);

    expect(await describeKeyByUid(key.keyUid)).toBeNull();
    expect(await searchStatusWithKey(key.keyValue, indexUidFor(TEST_INSTANCE_ID))).toBe(
      403
    );
    expect(await getLiveSearchKey(TEST_INSTANCE_ID)).toBeNull();
  });

  it("revoking with no live key reports that rather than failing", async () => {
    await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    await revokeInstanceSearchKey(TEST_INSTANCE_ID);

    expect(await revokeInstanceSearchKey(TEST_INSTANCE_ID)).toBe(false);
  });

  it("re-issues a different key after revocation and keeps the history", async () => {
    const original = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);
    await revokeInstanceSearchKey(TEST_INSTANCE_ID);
    const replacement = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);

    expect(replacement.keyUid).not.toBe(original.keyUid);
    expect(replacement.keyValue).not.toBe(original.keyValue);

    const status = await getSearchKeyStatus(TEST_INSTANCE_ID);
    expect(status.record?.keyUid).toBe(replacement.keyUid);
    expect(status.history.length).toBeGreaterThanOrEqual(1);
    expect(status.history.every((h) => h.revokedAt !== null)).toBe(true);
  });

  it("surfaces a key deleted in Meilisearch behind our back", async () => {
    const key = await getOrCreateInstanceSearchKey(TEST_INSTANCE_ID);

    // Exactly what an operator does in the Meilisearch console: delete the key
    // and tell nobody. Our row still says live, so the panel has to catch it.
    await deleteKeyByUid(key.keyUid);

    const status = await getSearchKeyStatus(TEST_INSTANCE_ID);
    expect(status.record).not.toBeNull();
    expect(status.liveUpstream).toBe(false);
    expect(status.revokedOutOfBand).toBe(true);
  });
});
