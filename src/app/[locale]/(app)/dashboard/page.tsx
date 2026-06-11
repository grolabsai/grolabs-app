import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Link } from "@/i18n/routing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NoResultsTable, type NoResultRow } from "./_no-results-table";

type TimeWindow = "24h" | "7d" | "30d";

// TODO: verify correct analytics subdomains for regions:
// in, sg, au, br, ca, za, uae, uk, jp, hk
function analyticsHost(region: string): string {
  switch (region) {
    case "us":
      return "analytics.us.algolia.com";
    case "eu":
      return "analytics.de.algolia.com";
    case "de":
      return "analytics.de.algolia.com";
    default:
      return "analytics.us.algolia.com";
  }
}

function dateRange(tw: TimeWindow): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const start = new Date(today);
  if (tw === "24h") start.setDate(start.getDate() - 1);
  else if (tw === "7d") start.setDate(start.getDate() - 7);
  else start.setDate(start.getDate() - 30);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; offset?: string }>;
}) {
  const t = await getTranslations("dashboard");
  const { window: windowParam = "7d", offset: offsetParam = "0" } =
    await searchParams;

  const timeWindow = (
    ["24h", "7d", "30d"].includes(windowParam) ? windowParam : "7d"
  ) as TimeWindow;
  const offset = Math.max(0, parseInt(offsetParam, 10) || 0);

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
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  type AlgoliaConfig = {
    app_id?: string;
    region?: string;
    primary_index?: string;
    search_api_key?: string;
  };
  const algolia: AlgoliaConfig =
    (instanceRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};

  // The dashboard renders as soon as the search config is present — it does
  // NOT require the Write (Admin) key. Reading analytics needs a key with
  // Algolia's `analytics` ACL; writing synonyms needs the Write key.
  const isConfigured = !!(
    algolia.app_id &&
    algolia.region &&
    algolia.primary_index
  );

  let adminKey: string | null = null;
  if (isConfigured) {
    const { data: key } = await supabase.rpc("algolia_get_admin_key", {
      p_instance_id: instanceId,
    });
    adminKey = (key as string | null) ?? null;
  }

  // Synonyms (writes) require the admin key. Analytics (reads) need any key
  // carrying the `analytics` ACL. Try the admin key first (always has it when
  // present), then fall back to the search key — which works only if the
  // merchant granted it the analytics ACL. This lets an analytics-enabled
  // search key drive the dashboard even when the saved Write key can't.
  const canAddSynonyms = !!adminKey;
  const analyticsKeys = [...new Set(
    [adminKey, algolia.search_api_key].filter((k): k is string => !!k)
  )];

  let noResults: NoResultRow[] = [];
  let hasMore = false;
  // null = ok; "acl" = no key has the analytics ACL; "generic" = other failure.
  let analyticsError: "acl" | "generic" | null = null;

  if (isConfigured && analyticsKeys.length > 0) {
    const host = analyticsHost(algolia.region!);
    const { startDate, endDate } = dateRange(timeWindow);
    const url =
      `https://${host}/2/searches/noResults` +
      `?index=${encodeURIComponent(algolia.primary_index!)}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&limit=50` +
      `&offset=${offset}`;

    let succeeded = false;
    let sawAclFailure = false;
    for (const key of analyticsKeys) {
      try {
        const res = await fetch(url, {
          headers: {
            "x-algolia-application-id": algolia.app_id!,
            "x-algolia-api-key": key,
            accept: "application/json",
          },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          const raw: NoResultRow[] = data.searches ?? [];
          noResults = raw.filter(
            (row) => row.search !== "<empty search>" && row.search !== ""
          );
          hasMore = raw.length === 50;
          succeeded = true;
          break;
        } else if (res.status === 401 || res.status === 403) {
          sawAclFailure = true; // this key lacks the ACL — try the next one
        } else {
          analyticsError = "generic";
          break;
        }
      } catch {
        analyticsError = "generic";
        break;
      }
    }
    if (!succeeded && !analyticsError) {
      analyticsError = sawAclFailure ? "acl" : "generic";
    }
  } else if (isConfigured) {
    // Configured for search but no key at all that could read analytics.
    analyticsError = "acl";
  }

  return (
    <div className="s-page-content">
      <div className="s-page-header">
        <h1 className="s-page-title">{t("title")}</h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Section A — Búsquedas sin resultados */}
        <Card>
          <CardHeader>
            <CardTitle>{t("noResults.title")}</CardTitle>
            <CardDescription>{t("noResults.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {!isConfigured ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
                  {t("noResults.notConfigured")}
                </p>
                <Link href="/configuration/algolia">
                  <button className="s-btn s-btn-primary">
                    {t("noResults.configureButton")}
                  </button>
                </Link>
              </div>
            ) : (
              <NoResultsTable
                rows={noResults}
                timeWindow={timeWindow}
                offset={offset}
                hasMore={hasMore}
                canAddSynonyms={canAddSynonyms}
                analyticsError={analyticsError}
              />
            )}
          </CardContent>
        </Card>

        {/* Section B — Alertas del catálogo (placeholder) */}
        <Card>
          <CardHeader>
            <CardTitle>{t("catalogAlerts.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
              {t("catalogAlerts.placeholder")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
