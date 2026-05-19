import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { WooImportClient } from "./_client";
import { getImportStatus } from "./actions";

/**
 * /import/woocommerce — admin entrypoint for the WooCommerce → GroLabs
 * pull import. Spec: docs/policy/wc-import.md §6.
 *
 * Reads credentials from instance.integrations_config.woocommerce
 * (saved on /configuration/woocommerce); buttons are disabled when
 * credentials are missing.
 */

export const dynamic = "force-dynamic";

export default async function WooCommerceImportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  type WooConfig = {
    site_url?: string;
    consumer_key?: string;
    last_verified_at?: string;
    last_http_status?: number;
  };
  const wc: WooConfig =
    (instanceRow?.integrations_config as { woocommerce?: WooConfig })?.woocommerce ?? {};

  let hasSecret = false;
  if (wc.site_url) {
    const { data: secret } = await supabase.rpc("woocommerce_get_consumer_secret", {
      p_instance_id: instanceId,
    });
    hasSecret = !!secret;
  }

  const configured = !!(wc.site_url && wc.consumer_key && hasSecret);
  const initialStatus = await getImportStatus();

  return (
    <div className="s-page-content">
      <WooImportClient
        configured={configured}
        siteUrl={wc.site_url ?? ""}
        initialStatus={initialStatus}
      />
    </div>
  );
}
