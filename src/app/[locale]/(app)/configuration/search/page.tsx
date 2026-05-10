import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ping } from "@/lib/search/meilisearch-client";
import { indexUidFor } from "@/lib/search/types";
import { SearchSettingsForm } from "./_form";

/**
 * Stage 0 admin panel for Meilisearch search infrastructure.
 *
 * Per docs/policy/search-foundations.md §8. Server component fetches initial
 * connection status and the instance's current storefront_domains; client
 * form handles edits + manual re-test.
 */
export default async function SearchConfigPage() {
  const t = await getTranslations("configuration.search");
  const supabase = await createClient();

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

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("storefront_domains")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const initialDomains: string[] = Array.isArray(instanceRow?.storefront_domains)
    ? instanceRow!.storefront_domains
    : [];

  // Initial health probe (server side). The form re-tests on demand.
  const initialHealth = await ping();

  return (
    <div className="s-page-content">
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchSettingsForm
            instanceId={instanceId}
            indexUid={indexUidFor(instanceId)}
            initialDomains={initialDomains}
            initialHealth={initialHealth}
          />
        </CardContent>
      </Card>
    </div>
  );
}
