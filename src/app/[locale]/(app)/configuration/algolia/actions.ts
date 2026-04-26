"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TestResult = {
  ok: boolean;
  status: number;
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
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": adminKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 0, message };
  }
}

export type SavePayload = {
  tenantId: number;
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
  error?: string;
};

/**
 * Persist Algolia credentials, then test the connection and record the result.
 *
 * When adminApiKey is omitted the existing Vault secret is re-used:
 * we fetch it via algolia_get_admin_key and pass it back into
 * algolia_save_credentials so non-secret fields are updated without
 * disrupting the stored key.
 */
export async function saveAlgoliaConfig(
  payload: SavePayload
): Promise<SaveResult> {
  const supabase = await createClient();
  const { tenantId, appId, region, searchApiKey, adminApiKey, primaryIndex } =
    payload;

  // ── Resolve the admin key we'll use ────────────────────────────────────────
  let effectiveAdminKey: string;

  if (adminApiKey) {
    effectiveAdminKey = adminApiKey;
  } else {
    // User kept the existing key — fetch from Vault before overwriting config.
    const { data: storedKey, error: keyError } = await supabase.rpc(
      "algolia_get_admin_key",
      { p_tenant_id: tenantId }
    );
    if (keyError || !storedKey) {
      return {
        ok: false,
        verified: false,
        error: keyError?.message ?? "No admin key on file — provide one to save",
      };
    }
    effectiveAdminKey = storedKey as string;
  }

  // ── Persist all fields ──────────────────────────────────────────────────────
  const { error: saveError } = await supabase.rpc("algolia_save_credentials", {
    p_tenant_id: tenantId,
    p_app_id: appId,
    p_region: region,
    p_search_key: searchApiKey,
    p_admin_key: effectiveAdminKey,
    p_index: primaryIndex,
  });
  if (saveError) {
    return { ok: false, verified: false, error: saveError.message };
  }

  // ── Test connection ─────────────────────────────────────────────────────────
  const testResult = await testAlgoliaConnection(appId, effectiveAdminKey);

  // ── Record verification result ──────────────────────────────────────────────
  await supabase.rpc("algolia_record_verification", {
    p_tenant_id: tenantId,
    p_http_status: testResult.status,
  });

  // ── Invalidate page cache ───────────────────────────────────────────────────
  revalidatePath("/configuration/algolia");

  return {
    ok: true,
    verified: testResult.ok,
    httpStatus: testResult.status,
  };
}
