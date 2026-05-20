import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ping } from "@/lib/search/meilisearch-client";
import { indexUidFor } from "@/lib/search/types";
import { getIndexingStatus } from "./actions";
import { SearchSettingsForm } from "./_form";
import { SearchPreview } from "./_search-preview";
import { SearchRequestLog } from "./_request-log";
import { SearchEventLog } from "./_event-log";
import { SearchVolumeBlock } from "@/components/analytics/SearchVolumeBlock";
import { NoResultRateBlock } from "@/components/analytics/NoResultRateBlock";
import { LatencyBlock } from "@/components/analytics/LatencyBlock";
import { TopQueriesBlock } from "@/components/analytics/TopQueriesBlock";
import { TopNoResultQueriesBlock } from "@/components/analytics/TopNoResultQueriesBlock";
import { StorefrontBreakdownBlock } from "@/components/analytics/StorefrontBreakdownBlock";
import { IndexHealthBlock } from "@/components/analytics/IndexHealthBlock";
import { IndexSizeBlock } from "@/components/analytics/IndexSizeBlock";
import { FieldDistributionBlock } from "@/components/analytics/FieldDistributionBlock";

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
  const initialStatus = await getIndexingStatus(instanceId);

  return (
    <div className="s-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(380px, 1fr) minmax(360px, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
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
              initialStatus={initialStatus}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("preview.cardTitle")}</CardTitle>
            <CardDescription>{t("preview.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SearchPreview instanceId={instanceId} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("requestLog.cardTitle")}</CardTitle>
          <CardDescription>{t("requestLog.cardDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchRequestLog instanceId={instanceId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("eventLog.cardTitle")}</CardTitle>
          <CardDescription>{t("eventLog.cardDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchEventLog instanceId={instanceId} />
        </CardContent>
      </Card>

      {/* Analytics block bench. Each block is self-contained and can be lifted
          onto /dashboard, an admin overview, or anywhere else by changing only
          the import path. Layout here is intentionally generic (responsive
          grid) so blocks read identically wherever they land. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        <SearchVolumeBlock instanceId={instanceId} />
        <NoResultRateBlock instanceId={instanceId} />
        <LatencyBlock instanceId={instanceId} />
        <IndexHealthBlock instanceId={instanceId} />
        <IndexSizeBlock instanceId={instanceId} />
        <StorefrontBreakdownBlock instanceId={instanceId} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <TopQueriesBlock instanceId={instanceId} />
        <TopNoResultQueriesBlock instanceId={instanceId} />
        <FieldDistributionBlock instanceId={instanceId} />
      </div>
    </div>
  );
}
