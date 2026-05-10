import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { WooImportPanel } from "./_client";
import { getImportStatus } from "./actions";

/**
 * /import/woocommerce — admin entrypoint for the WooCommerce → Scout
 * pull import. Spec: docs/policy/wc-import.md §6.
 *
 * Reads credentials from instance.integrations_config.woocommerce
 * (saved on /configuration/woocommerce); buttons are disabled when
 * credentials are missing.
 */

export const dynamic = "force-dynamic";

export default async function WooCommerceImportPage() {
  const t = await getTranslations("import.woocommerce");
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
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>
            {configured
              ? t("pageDescriptionConfigured", { siteUrl: wc.site_url ?? "" })
              : t("pageDescriptionMissing")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WooImportPanel configured={configured} initialStatus={initialStatus} />
        </CardContent>
      </Card>
    </div>
  );
}
