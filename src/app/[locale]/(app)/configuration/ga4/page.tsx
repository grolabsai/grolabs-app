import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { NoAccess } from "@/components/auth/NoAccess";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Ga4Config } from "@/lib/integrations/ga4/types";
import { listGa4PropertyOptions } from "@/lib/integrations/ga4/fetchers";
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

  // Resolve via the canonical self-healing resolver (same as
  // dashboard/traffic/page.tsx). The old is_active .maybeSingle() lookup
  // errored for multi-instance users and redirected them to /login, so this
  // page (and its pre-connect CTA) never rendered. Never redirect an
  // authenticated user to /login here — it bounces back and loops.
  const instanceId = await currentInstanceId();
  if (instanceId == null) return <NoAccess />;

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("name, integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const ga4: Ga4Config =
    (instanceRow?.integrations_config as { ga4?: Ga4Config })?.ga4 ?? {};
  const instanceName = (instanceRow?.name as string | null) ?? "";

  const { data: refreshTok } = await supabase.rpc("ga4_get_refresh_token", {
    p_instance_id: instanceId,
  });
  const hasRefreshToken =
    typeof refreshTok === "string" && refreshTok.length > 0;

  // Resolve the property list server-side so the picker renders ready. Skipped
  // when there's nothing to list or the grant is known-dead — both render other
  // states anyway. Returns null on any failure; the form falls back to manual
  // numeric entry.
  const properties =
    hasRefreshToken && ga4.needs_reauth !== true
      ? await listGa4PropertyOptions(instanceId)
      : null;

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
              needsReauth: ga4.needs_reauth === true,
              reauthReason: ga4.reauth_reason ?? undefined,
            }}
            hasRefreshToken={hasRefreshToken}
            instanceName={instanceName}
            initialProperties={properties}
          />
        </CardContent>
      </Card>
    </div>
  );
}
