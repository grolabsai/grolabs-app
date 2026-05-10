import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlgoliaForm } from "./_form";

/**
 * Algolia configuration page (server component).
 *
 * Loads the instance's current Algolia config from integrations_config and
 * passes it to the client form as initial values. The admin key is fetched
 * from Vault via RPC so it never touches the browser.
 */
export default async function AlgoliaConfigPage() {
  const t = await getTranslations("configuration.algolia");
  const supabase = await createClient();

  // ── Auth & instance resolution ──────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  if (!membership) redirect("/login");

  const instanceId: number = membership.instance_id;

  // ── Load existing config ────────────────────────────────────────────────────
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  type AlgoliaConfig = {
    app_id?: string;
    region?: string;
    search_api_key?: string;
    primary_index?: string;
    last_verified_at?: string;
    last_http_status?: number;
    last_verified_latency_ms?: number;
  };

  const algolia: AlgoliaConfig =
    (instanceRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};

  // ── Fetch admin key existence (boolean only — never expose the value) ───────
  // We call algolia_get_admin_key to check if one is stored; the actual value
  // stays on the server and is only used for test calls inside server actions.
  let hasAdminKey = false;
  if (algolia.app_id) {
    const { data: key } = await supabase.rpc("algolia_get_admin_key", {
      p_instance_id: instanceId,
    });
    hasAdminKey = !!key;
  }

  return (
    <div className="s-page-content">
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
      <AlgoliaForm
        instanceId={instanceId}
        initialValues={{
          appId: algolia.app_id ?? "",
          region: algolia.region ?? "",
          searchApiKey: algolia.search_api_key ?? "",
          primaryIndex: algolia.primary_index ?? "",
          lastVerifiedAt: algolia.last_verified_at,
          lastHttpStatus: algolia.last_http_status,
          lastVerifiedLatencyMs: algolia.last_verified_latency_ms,
        }}
        hasAdminKey={hasAdminKey}
      />
        </CardContent>
      </Card>
    </div>
  );
}
