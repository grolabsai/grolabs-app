/**
 * Tiny Algolia REST client — just the operations Scout needs.
 *
 * We don't pull in algoliasearch's full SDK because:
 *   1. We only call two operations (batch upsert + batch delete).
 *   2. Their SDK ships ~200 KB of JS into our bundle for very little gain.
 *
 * Algolia REST docs: https://www.algolia.com/doc/rest-api/search/
 *
 * Auth headers required on every call:
 *   X-Algolia-Application-Id: <appId>
 *   X-Algolia-API-Key:        <admin key>   (write ops need the admin key)
 *
 * URL form for any DSN endpoint:
 *   https://{appId}-dsn.algolia.net/...
 *
 * Each batch is capped at 1,000 actions and ~10 MB by Algolia. We batch
 * client-side at 100 records per request to keep payload size sane and
 * surface partial failures more usefully.
 */

const BATCH_SIZE = 100;

export type AlgoliaClient = {
  appId: string;
  adminKey: string;
};

export type AlgoliaBatchResult = {
  /** Number of records successfully sent (sum of all batch responses). */
  ok: number;
  /** Number of records that errored out. */
  failed: number;
  /** First error encountered, for surfacing to the user. */
  firstError?: string;
};

type BatchAction =
  | { action: "addObject"; body: Record<string, unknown> }
  | { action: "deleteObject"; body: { objectID: string } };

async function postBatch(
  client: AlgoliaClient,
  index: string,
  actions: BatchAction[],
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://${client.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/batch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": client.appId,
      "X-Algolia-API-Key": client.adminKey,
    },
    body: JSON.stringify({ requests: actions }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      status: res.status,
      error: `Algolia batch failed (${res.status}): ${body || res.statusText}`,
    };
  }
  return { ok: true, status: res.status };
}

/**
 * Upsert objects into an index. Each object must have `objectID`.
 * Returns aggregate counts; surfaces only the first error to the caller.
 */
export async function saveObjects(
  client: AlgoliaClient,
  index: string,
  records: Array<Record<string, unknown> & { objectID: string }>,
): Promise<AlgoliaBatchResult> {
  if (records.length === 0) return { ok: 0, failed: 0 };
  const result: AlgoliaBatchResult = { ok: 0, failed: 0 };

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const slice = records.slice(i, i + BATCH_SIZE);
    const actions: BatchAction[] = slice.map((body) => ({ action: "addObject", body }));
    const r = await postBatch(client, index, actions);
    if (r.ok) {
      result.ok += slice.length;
    } else {
      result.failed += slice.length;
      if (!result.firstError) result.firstError = r.error;
    }
  }
  return result;
}

/**
 * Delete objects by objectID.
 */
export async function deleteObjects(
  client: AlgoliaClient,
  index: string,
  objectIDs: string[],
): Promise<AlgoliaBatchResult> {
  if (objectIDs.length === 0) return { ok: 0, failed: 0 };
  const result: AlgoliaBatchResult = { ok: 0, failed: 0 };

  for (let i = 0; i < objectIDs.length; i += BATCH_SIZE) {
    const slice = objectIDs.slice(i, i + BATCH_SIZE);
    const actions: BatchAction[] = slice.map((id) => ({
      action: "deleteObject",
      body: { objectID: id },
    }));
    const r = await postBatch(client, index, actions);
    if (r.ok) {
      result.ok += slice.length;
    } else {
      result.failed += slice.length;
      if (!result.firstError) result.firstError = r.error;
    }
  }
  return result;
}
