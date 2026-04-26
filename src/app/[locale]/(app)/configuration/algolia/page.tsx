import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { AlgoliaForm } from "./_form";

/**
 * Algolia configuration page (server component).
 *
 * Loads the tenant's current Algolia config from integrations_config and
 * passes it to the client form as initial values. The admin key is fetched
 * from Vault via RPC so it never touches the browser.
 */
export default async function AlgoliaConfigPage() {
  const t = await getTranslations("configuration.algolia");
  const supabase = await createClient();

  // ── Auth & tenant resolution ────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("tenant_member")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership) redirect("/login");

  const tenantId: number = membership.tenant_id;

  // ── Load existing config ────────────────────────────────────────────────────
  const { data: tenantRow } = await supabase
    .from("tenant")
    .select("integrations_config")
    .eq("id", tenantId)
    .maybeSingle();

  type AlgoliaConfig = {
    app_id?: string;
    region?: string;
    search_api_key?: string;
    primary_index?: string;
    last_verified_at?: string;
    last_http_status?: number;
  };

  const algolia: AlgoliaConfig =
    (tenantRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};

  // ── Fetch admin key existence (boolean only — never expose the value) ───────
  // We call algolia_get_admin_key to check if one is stored; the actual value
  // stays on the server and is only used for test calls inside server actions.
  let hasAdminKey = false;
  if (algolia.app_id) {
    const { data: key } = await supabase.rpc("algolia_get_admin_key", {
      p_tenant_id: tenantId,
    });
    hasAdminKey = !!key;
  }

  return (
    <div className="s-page-content">
      <div className="s-page-header">
        <h1 className="s-page-title">{t("pageTitle")}</h1>
        <p className="s-page-description">{t("pageDescription")}</p>
      </div>

      <AlgoliaForm
        tenantId={tenantId}
        initialValues={{
          appId: algolia.app_id ?? "",
          region: algolia.region ?? "",
          searchApiKey: algolia.search_api_key ?? "",
          primaryIndex: algolia.primary_index ?? "",
          lastVerifiedAt: algolia.last_verified_at,
          lastHttpStatus: algolia.last_http_status,
        }}
        hasAdminKey={hasAdminKey}
      />
    </div>
  );
}
