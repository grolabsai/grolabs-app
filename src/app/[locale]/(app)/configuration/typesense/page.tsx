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
import { TypesenseForm } from "./_form";

/**
 * Typesense configuration page (server component).
 *
 * Loads the instance's current Typesense config from integrations_config and
 * passes it to the client form. The admin key is fetched from Vault via RPC
 * so it never touches the browser — we only surface a boolean indicating
 * whether one is on file.
 */
export default async function TypesenseConfigPage() {
  const t = await getTranslations("configuration.typesense");
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

  type TypesenseConfig = {
    host?: string;
    port?: number;
    protocol?: string;
    search_only_api_key?: string;
    primary_collection?: string;
    last_verified_at?: string;
    last_http_status?: number;
    last_verified_latency_ms?: number;
  };

  const ts: TypesenseConfig =
    (instanceRow?.integrations_config as { typesense?: TypesenseConfig })
      ?.typesense ?? {};

  let hasAdminKey = false;
  if (ts.host) {
    const { data: key } = await supabase.rpc("typesense_get_admin_key", {
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
          <TypesenseForm
            instanceId={instanceId}
            initialValues={{
              host: ts.host ?? "",
              port: ts.port ?? 443,
              protocol: ts.protocol ?? "https",
              searchOnlyApiKey: ts.search_only_api_key ?? "",
              primaryCollection: ts.primary_collection ?? "",
              lastVerifiedAt: ts.last_verified_at,
              lastHttpStatus: ts.last_http_status,
              lastVerifiedLatencyMs: ts.last_verified_latency_ms,
            }}
            hasAdminKey={hasAdminKey}
          />
        </CardContent>
      </Card>
    </div>
  );
}
