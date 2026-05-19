"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyWooConnection, type WooClient } from "@/lib/sync/woocommerce-client";
import { loadWooClient } from "@/lib/import/woocommerce/client";
import {
  detectFieldSinks,
  type FieldDetectionReport,
} from "@/lib/sync/woocommerce-field-detection";

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

// ─── Field-sink detection ──────────────────────────────────────────────────

export type DetectResult =
  | { ok: true; report: FieldDetectionReport }
  | { ok: false; error: string };

/**
 * Probe the connected WooCommerce site to figure out where brand, barcode,
 * and cost are actually stored / can be stored. The user clicks "Detect"
 * once, the result is cached on `instance.integrations_config.woocommerce
 * .field_sinks`, and a follow-up task will let them pick the write target
 * for each concept (which the push will then honour).
 *
 * Detection is read-only: it calls /products/brands, /wp/v2/taxonomies,
 * and samples one page of products. It does NOT change any WC data.
 */
export async function detectWooCommerceFieldSinks(
  instanceId: number,
): Promise<DetectResult> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: "Sesión expirada." };

  // Credentials are read via the user-scoped client because the
  // woocommerce_get_consumer_secret RPC enforces instance_member via
  // auth.uid(); under service-role auth.uid() is null and the RPC denies.
  const wcResult = await loadWooClient(userClient, instanceId);
  if (!wcResult.ok) return { ok: false, error: wcResult.reason };

  let report: FieldDetectionReport;
  try {
    report = await detectFieldSinks(wcResult.client);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Persist on integrations_config.woocommerce.field_sinks. Use the
  // service-role client for the update so we don't have to relax RLS on
  // the instance table for this single field. The read above already
  // confirmed the caller belongs to this instance.
  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const current =
    (row?.integrations_config as Record<string, unknown> | null) ?? {};
  const wc = (current.woocommerce as Record<string, unknown> | undefined) ?? {};
  const next = {
    ...current,
    woocommerce: { ...wc, field_sinks: report },
  };

  const { error: updErr } = await admin
    .from("instance")
    .update({ integrations_config: next })
    .eq("instance_id", instanceId);
  if (updErr) {
    // The probe succeeded but persistence failed — still surface the report
    // to the user, they can re-detect later.
    return { ok: true, report };
  }

  revalidatePath("/configuration/woocommerce");
  return { ok: true, report };
}

/** Read the most recently stored detection report, if any. Server-side
 *  helper used by the configuration page to render initial state. */
export async function getStoredFieldSinks(
  instanceId: number,
): Promise<FieldDetectionReport | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();
  const wc =
    ((data?.integrations_config as { woocommerce?: { field_sinks?: FieldDetectionReport } })
      ?.woocommerce ?? {}).field_sinks ?? null;
  return wc;
}
