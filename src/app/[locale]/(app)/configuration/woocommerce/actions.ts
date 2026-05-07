"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verifyWooConnection, type WooClient } from "@/lib/sync/woocommerce-client";

export type SavePayload = {
  instanceId: number;
  siteUrl: string;
  consumerKey: string;
  /** When omitted, the existing Vault secret is preserved (non-secret fields only updated). */
  consumerSecret?: string;
};

export type SaveResult = {
  ok: boolean;
  verified: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
};

export type TestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

/**
 * Pure HTTP probe (no DB side-effects). Used by the form's "Test connection"
 * button when the user wants to validate creds before saving.
 */
export async function testWooCommerceConnection(
  siteUrl: string,
  consumerKey: string,
  consumerSecret: string,
): Promise<TestResult> {
  const client: WooClient = {
    siteUrl: siteUrl.replace(/\/+$/, ""),
    consumerKey,
    consumerSecret,
  };
  const r = await verifyWooConnection(client);
  return r;
}

/**
 * Persist WC credentials, then test the connection and record the result.
 * If consumerSecret is omitted the existing Vault secret stays in place
 * — the user kept the field hidden and only updated the URL or key.
 */
export async function saveWooCommerceConfig(
  payload: SavePayload,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { instanceId, siteUrl, consumerKey, consumerSecret } = payload;

  let effectiveSecret: string;

  if (consumerSecret) {
    effectiveSecret = consumerSecret;
  } else {
    const { data: stored, error } = await supabase.rpc("woocommerce_get_consumer_secret", {
      p_instance_id: instanceId,
    });
    if (error || !stored) {
      return {
        ok: false,
        verified: false,
        error: error?.message ?? "No hay consumer secret en Vault — ingresa uno.",
      };
    }
    effectiveSecret = stored as string;
  }

  // Persist non-secret fields + write/update Vault
  const { error: saveErr } = await supabase.rpc("woocommerce_save_credentials", {
    p_instance_id: instanceId,
    p_site_url: siteUrl,
    p_consumer_key: consumerKey,
    p_consumer_secret: effectiveSecret,
  });
  if (saveErr) {
    return { ok: false, verified: false, error: saveErr.message };
  }

  // Verify
  const t = await testWooCommerceConnection(siteUrl, consumerKey, effectiveSecret);

  // Record verification
  await supabase.rpc("woocommerce_record_verification", {
    p_instance_id: instanceId,
    p_http_status: t.status,
    p_latency_ms: t.latencyMs,
  });

  revalidatePath("/configuration/woocommerce");

  return {
    ok: true,
    verified: t.ok,
    httpStatus: t.status,
    latencyMs: t.latencyMs,
  };
}
