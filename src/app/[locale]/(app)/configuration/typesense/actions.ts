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
 * Test a Typesense connection by hitting GET /keys with the admin key.
 * Pure HTTP probe — no DB side-effects. Listing keys requires a valid
 * admin-scoped API key, so a 200 response confirms write access.
 */
export async function testTypesenseConnection(
  host: string,
  port: number,
  protocol: string,
  adminKey: string,
): Promise<TestResult> {
  const url = `${protocol}://${host}:${port}/keys`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-TYPESENSE-API-KEY": adminKey },
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
  host: string;
  port: number;
  protocol: string;
  searchOnlyApiKey: string;
  /** Present only when the user wants to set/replace the admin key. */
  adminApiKey?: string;
  primaryCollection: string;
};

export type SaveResult = {
  ok: boolean;
  verified: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
};

/**
 * Persist Typesense credentials, then test the connection and record the result.
 *
 * When adminApiKey is omitted the existing Vault secret is re-used:
 * fetch via typesense_get_admin_key and pass back into typesense_save_credentials
 * so non-secret fields update without disrupting the stored key.
 */
export async function saveTypesenseConfig(
  payload: SavePayload,
): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    instanceId,
    host,
    port,
    protocol,
    searchOnlyApiKey,
    adminApiKey,
    primaryCollection,
  } = payload;

  let effectiveAdminKey: string;

  if (adminApiKey) {
    effectiveAdminKey = adminApiKey;
  } else {
    const { data: storedKey, error: keyError } = await supabase.rpc(
      "typesense_get_admin_key",
      { p_instance_id: instanceId },
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

  const { error: saveError } = await supabase.rpc("typesense_save_credentials", {
    p_instance_id: instanceId,
    p_host: host,
    p_port: port,
    p_protocol: protocol,
    p_search_only_key: searchOnlyApiKey,
    p_admin_key: effectiveAdminKey,
    p_primary_collection: primaryCollection,
  });
  if (saveError) {
    return { ok: false, verified: false, error: saveError.message };
  }

  const testResult = await testTypesenseConnection(
    host,
    port,
    protocol,
    effectiveAdminKey,
  );

  await supabase.rpc("typesense_record_verification", {
    p_instance_id: instanceId,
    p_http_status: testResult.status,
    p_latency_ms: testResult.latencyMs,
  });

  revalidatePath("/configuration/typesense");

  return {
    ok: true,
    verified: testResult.ok,
    httpStatus: testResult.status,
    latencyMs: testResult.latencyMs,
  };
}
