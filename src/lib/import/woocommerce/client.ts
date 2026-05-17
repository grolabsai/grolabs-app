/**
 * Resolve a usable WooClient for a given GroLabs instance.
 *
 * Reads non-secret config (site_url, consumer_key) from
 * instance.integrations_config.woocommerce, fetches consumer_secret
 * from Vault via the existing woocommerce_get_consumer_secret RPC.
 * Caller decides whether to use the user-scoped or service-role
 * supabase client; both expose the same RPC.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WooClient } from "@/lib/sync/woocommerce-client";

export type LoadResult =
  | { ok: true; client: WooClient }
  | { ok: false; reason: string };

type WooConfig = {
  site_url?: string;
  consumer_key?: string;
};

export async function loadWooClient(
  supabase: SupabaseClient,
  instanceId: number,
): Promise<LoadResult> {
  const { data: instanceRow, error: cfgErr } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  if (cfgErr) {
    return { ok: false, reason: `Could not load instance config: ${cfgErr.message}` };
  }

  const wc: WooConfig =
    (instanceRow?.integrations_config as { woocommerce?: WooConfig })?.woocommerce ?? {};

  if (!wc.site_url || !wc.consumer_key) {
    return { ok: false, reason: "WooCommerce credentials are not configured." };
  }

  const { data: secret, error: secretErr } = await supabase.rpc(
    "woocommerce_get_consumer_secret",
    { p_instance_id: instanceId },
  );

  if (secretErr || !secret) {
    return {
      ok: false,
      reason: secretErr?.message ?? "Consumer secret missing from Vault.",
    };
  }

  return {
    ok: true,
    client: {
      siteUrl: String(wc.site_url).replace(/\/+$/, ""),
      consumerKey: String(wc.consumer_key),
      consumerSecret: String(secret),
    },
  };
}
