import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WooCommerceForm } from "./_form";

/**
 * WooCommerce configuration page.
 *
 * Mirrors /configuration/algolia: loads the public config from
 * instance.integrations_config, checks Vault for the consumer secret
 * (boolean only — never reads the value into the page tree).
 */
export default async function WooCommerceConfigPage() {
  const t = await getTranslations("configuration.woocommerce");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) redirect("/login");
  const instanceId: number = membership.instance_id;

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
    last_verified_latency_ms?: number;
  };

  const wc: WooConfig =
    (instanceRow?.integrations_config as { woocommerce?: WooConfig })?.woocommerce ?? {};

  let hasConsumerSecret = false;
  if (wc.site_url) {
    const { data: secret } = await supabase.rpc("woocommerce_get_consumer_secret", {
      p_instance_id: instanceId,
    });
    hasConsumerSecret = !!secret;
  }

  return (
    <div className="s-page-content">
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <WooCommerceForm
            instanceId={instanceId}
            initialValues={{
              siteUrl: wc.site_url ?? "",
              consumerKey: wc.consumer_key ?? "",
              lastVerifiedAt: wc.last_verified_at,
              lastHttpStatus: wc.last_http_status,
              lastVerifiedLatencyMs: wc.last_verified_latency_ms,
            }}
            hasConsumerSecret={hasConsumerSecret}
          />
        </CardContent>
      </Card>
    </div>
  );
}
