"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

/**
 * Test an Algolia connection by hitting the /1/keys endpoint.
 * Pure HTTP probe — no DB side-effects.
 */
export async function testAlgoliaConnection(
  appId: string,
  adminKey: string
): Promise<TestResult> {
  const url = `https://${appId}-dsn.algolia.net/1/keys/${adminKey}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": adminKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 0, latencyMs: Date.now() - start, message };
  }
}

export type SavePayload = {
  instanceId: number;
  appId: string;
  region: string;
  searchApiKey: string;
  /** Present only when the user wants to set/replace the admin key. */
  adminApiKey?: string;
  primaryIndex: string;
};

export type SaveResult = {
  ok: boolean;
  verified: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
};

/**
 * Persist Algolia credentials. Saving is NEVER blocked by incomplete data:
 * the non-secret fields are always written, and the admin key is optional.
 *
 * Admin-key resolution:
 *   - adminApiKey provided  → use it (and write it to Vault).
 *   - omitted but on file   → re-use the stored Vault secret for verification.
 *   - omitted and none on file → save config only; skip verification.
 *
 * When we end up with an admin key we also test the connection and record the
 * result; without one, the save still succeeds and verification is simply
 * skipped (verified: false, no httpStatus).
 */
export async function saveAlgoliaConfig(
  payload: SavePayload
): Promise<SaveResult> {
  const supabase = await createClient();
  const { instanceId, appId, region, searchApiKey, adminApiKey, primaryIndex } =
    payload;

  // ── Resolve the admin key we'll use (may be null — that's fine) ─────────────
  let effectiveAdminKey: string | null = null;

  if (adminApiKey) {
    effectiveAdminKey = adminApiKey;
  } else {
    // No new key supplied — re-use the stored one if there is any. A missing
    // key never blocks the save; it only means we can't verify.
    const { data: storedKey } = await supabase.rpc("algolia_get_admin_key", {
      p_instance_id: instanceId,
    });
    effectiveAdminKey = (storedKey as string | null) ?? null;
  }

  // ── Persist all fields (admin key optional — RPC skips Vault when null) ──────
  const { error: saveError } = await supabase.rpc("algolia_save_credentials", {
    p_instance_id: instanceId,
    p_app_id: appId,
    p_region: region,
    p_search_key: searchApiKey,
    p_admin_key: effectiveAdminKey,
    p_index: primaryIndex,
  });
  if (saveError) {
    // A genuine DB/RLS failure — not an "incomplete data" block.
    return { ok: false, verified: false, error: saveError.message };
  }

  // ── No key → saved, verification skipped ────────────────────────────────────
  if (!effectiveAdminKey) {
    revalidatePath("/configuration/algolia");
    return { ok: true, verified: false };
  }

  // ── Test connection + record verification ───────────────────────────────────
  const testResult = await testAlgoliaConnection(appId, effectiveAdminKey);

  await supabase.rpc("algolia_record_verification", {
    p_instance_id: instanceId,
    p_http_status: testResult.status,
    p_latency_ms: testResult.latencyMs,
  });

  revalidatePath("/configuration/algolia");

  return {
    ok: true,
    verified: testResult.ok,
    httpStatus: testResult.status,
    latencyMs: testResult.latencyMs,
  };
}
