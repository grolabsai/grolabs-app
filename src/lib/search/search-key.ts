import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  createInstanceSearchKey,
  deleteKeyByUid,
  describeKeyByUid,
  meilisearchHost,
  searchKeyNameFor,
} from "./meilisearch-client";
import { indexUidFor } from "./types";

/**
 * Lifecycle of the permanent per-instance storefront search key.
 *
 * Per docs/design/direct-meilisearch-search.md Phase 1. The storefront talks
 * to Meilisearch directly, so it carries its own credential: one search-only
 * API key per instance, scoped to that instance's index, with no expiry and
 * no renewal. Nothing GroLabs runs on a schedule can take a merchant's search
 * down, because nothing GroLabs runs is in that path (R-1, R-2).
 *
 * Revocation is manual and non-destructive: delete the key (here or by hand in
 * the Meilisearch console) and that storefront stops returning results within
 * seconds, with its catalog index untouched (R-4, T-4).
 *
 * Why this module owns both the HTTP call and the DB write: provisioning has
 * to create the key upstream and persist it as one operation, so it cannot
 * live in a SECURITY DEFINER RPC the way byo_write_key does. The `search_key`
 * table is therefore deny-all RLS and reached only from here, under the
 * service-role client. Callers are responsible for checking membership first
 * — the server actions in the configuration screen do that.
 */

export type SearchKeyRecord = {
  searchKeyId: number;
  instanceId: number;
  keyUid: string;
  keyValue: string;
  keyName: string;
  createdAt: string;
  revokedAt: string | null;
};

/** What the configuration panel needs to render the key's state. */
export type SearchKeyStatus = {
  /** The live key, or null when the instance has never been provisioned or was revoked. */
  record: SearchKeyRecord | null;
  /**
   * Whether the key still exists in Meilisearch. `null` when we could not ask
   * (no key to check, or the probe itself failed) — distinct from `false`,
   * which means the key is genuinely gone upstream.
   */
  liveUpstream: boolean | null;
  /** True when a live row exists but the key is gone upstream: revoked by hand. */
  revokedOutOfBand: boolean;
  host: string;
  indexUid: string;
  expectedKeyName: string;
  /** Revoked keys, newest first — the audit trail of who was cut off when. */
  history: SearchKeyRecord[];
};

type SearchKeyRow = {
  search_key_id: number;
  instance_id: number;
  key_uid: string;
  key_value: string;
  key_name: string;
  created_at: string;
  revoked_at: string | null;
};

const ROW_COLUMNS =
  "search_key_id, instance_id, key_uid, key_value, key_name, created_at, revoked_at";

function toRecord(row: SearchKeyRow): SearchKeyRecord {
  return {
    searchKeyId: row.search_key_id,
    instanceId: row.instance_id,
    keyUid: row.key_uid,
    keyValue: row.key_value,
    keyName: row.key_name,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/** The instance's live key, or null. Does not touch Meilisearch. */
export async function getLiveSearchKey(
  instanceId: number
): Promise<SearchKeyRecord | null> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("search_key")
    .select(ROW_COLUMNS)
    .eq("instance_id", instanceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`getLiveSearchKey(${instanceId}) failed: ${error.message}`);
  return data ? toRecord(data as SearchKeyRow) : null;
}

/**
 * The instance's live key, provisioning one if it has none. Idempotent: an
 * instance that already holds a key gets it back without a Meilisearch call,
 * so this is safe to call from a page render.
 */
export async function getOrCreateInstanceSearchKey(
  instanceId: number,
  createdBy?: string | null
): Promise<SearchKeyRecord> {
  const existing = await getLiveSearchKey(instanceId);
  if (existing) return existing;

  const created = await createInstanceSearchKey(instanceId);

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("search_key")
    .insert({
      instance_id: instanceId,
      key_uid: created.uid,
      key_value: created.key,
      key_name: created.name,
      created_by: createdBy ?? null,
    })
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    // 23505 = unique violation on search_key_one_live_per_instance: a
    // concurrent caller provisioned first. Our upstream key is now an orphan
    // with nothing pointing at it, so delete it and return the winner's.
    if (error.code === "23505") {
      await deleteKeyByUid(created.uid).catch(() => {});
      const winner = await getLiveSearchKey(instanceId);
      if (winner) return winner;
    }
    // Any other failure leaves a key upstream we cannot reference. Clean it up
    // rather than leaking a credential nobody can see or revoke.
    await deleteKeyByUid(created.uid).catch(() => {});
    throw new Error(
      `getOrCreateInstanceSearchKey(${instanceId}) failed to persist: ${error.message}`
    );
  }

  return toRecord(data as SearchKeyRow);
}

/**
 * Cut the instance off: delete the key in Meilisearch and stamp the row.
 *
 * Tolerant of the key already being gone upstream (an operator may have
 * deleted it by hand) — the point is that the row ends up marked revoked
 * either way, so the configuration panel stops claiming the instance is live.
 *
 * Returns false when there was no live key to revoke.
 */
export async function revokeInstanceSearchKey(
  instanceId: number,
  revokedBy?: string | null
): Promise<boolean> {
  const live = await getLiveSearchKey(instanceId);
  if (!live) return false;

  await deleteKeyByUid(live.keyUid);

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("search_key")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy ?? null })
    .eq("search_key_id", live.searchKeyId);
  if (error) {
    throw new Error(
      `revokeInstanceSearchKey(${instanceId}) deleted the key upstream but failed to ` +
        `record it: ${error.message}`
    );
  }
  return true;
}

/**
 * Everything the configuration panel shows. Never provisions — reading a
 * screen should not mint a credential; that is an explicit action.
 */
export async function getSearchKeyStatus(instanceId: number): Promise<SearchKeyStatus> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("search_key")
    .select(ROW_COLUMNS)
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getSearchKeyStatus(${instanceId}) failed: ${error.message}`);

  const rows = (data ?? []) as SearchKeyRow[];
  const records = rows.map(toRecord);
  const record = records.find((r) => r.revokedAt === null) ?? null;
  const history = records.filter((r) => r.revokedAt !== null);

  let liveUpstream: boolean | null = null;
  if (record) {
    try {
      liveUpstream = (await describeKeyByUid(record.keyUid)) !== null;
    } catch {
      // The probe is diagnostics, not the answer. A Meilisearch blip must not
      // make the panel unrenderable.
      liveUpstream = null;
    }
  }

  // meilisearchHost() throws when the env var is absent. The panel is a status
  // readout, not a config gate — an unconfigured environment should render it
  // with a blank host, not take the whole settings page down.
  let host = "";
  try {
    host = meilisearchHost();
  } catch {
    host = "";
  }

  return {
    record,
    liveUpstream,
    revokedOutOfBand: record !== null && liveUpstream === false,
    host,
    indexUid: indexUidFor(instanceId),
    expectedKeyName: searchKeyNameFor(instanceId),
    history,
  };
}
