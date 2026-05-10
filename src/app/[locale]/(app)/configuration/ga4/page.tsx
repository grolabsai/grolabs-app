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
import type { Ga4Config } from "@/lib/integrations/ga4/types";
import { Ga4Form } from "./_form";

/**
 * GA4 configuration page.
 *
 * Mirrors /configuration/woocommerce: loads public config from
 * instance.integrations_config, checks Vault for the refresh token (boolean
 * only — never reads the value into the page tree).
 *
 * Two states:
 *   - hasRefreshToken=false → pre-connect CTA ("Conectar Google Analytics")
 *   - hasRefreshToken=true  → status panel + property ID + Pull Now / Disconnect
 */
export default async function Ga4ConfigPage() {
  const t = await getTranslations("configuration.ga4");
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

  const ga4: Ga4Config =
    (instanceRow?.integrations_config as { ga4?: Ga4Config })?.ga4 ?? {};

  const { data: refreshTok } = await supabase.rpc("ga4_get_refresh_token", {
    p_instance_id: instanceId,
  });
  const hasRefreshToken =
    typeof refreshTok === "string" && refreshTok.length > 0;

  return (
    <div className="s-page-content">
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Ga4Form
            initialValues={{
              propertyId: ga4.property_id,
              oauthAccountEmail: ga4.oauth_account_email,
              connectedAt: ga4.connected_at,
              lastPullAt: ga4.last_pull_at,
              lastPullStatus: ga4.last_pull_status,
              lastPullError: ga4.last_pull_error,
              lastPullLatencyMs: ga4.last_pull_latency_ms,
            }}
            hasRefreshToken={hasRefreshToken}
          />
        </CardContent>
      </Card>
    </div>
  );
}
