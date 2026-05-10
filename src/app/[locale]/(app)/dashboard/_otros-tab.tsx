import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getTopExitPages,
  getTopLandingPages,
} from "@/lib/integrations/ga4/fetchers";
import { PagesTable } from "@/components/dashboard/PagesTable";
import { NoResultsTable, type NoResultRow } from "./_no-results-table";

type AlgoliaTimeWindow = "24h" | "7d" | "30d";

interface AlgoliaConfig {
  app_id?: string;
  region?: string;
  primary_index?: string;
}

function analyticsHost(region: string): string {
  switch (region) {
    case "us":
      return "analytics.us.algolia.com";
    case "eu":
    case "de":
      return "analytics.de.algolia.com";
    default:
      return "analytics.us.algolia.com";
  }
}

function dateRange(tw: AlgoliaTimeWindow): {
  startDate: string;
  endDate: string;
} {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const start = new Date(today);
  if (tw === "24h") start.setDate(start.getDate() - 1);
  else if (tw === "7d") start.setDate(start.getDate() - 7);
  else start.setDate(start.getDate() - 30);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

/**
 * "Otros indicadores" tab content.
 *
 * Carries over the existing /dashboard "no results" Algolia surface verbatim
 * (dropdown, paging, add-synonym dialog) and adds the top entry / exit pages
 * tables sourced from GA4.
 *
 * The Algolia no-results section uses its own ?window=24h|7d|30d query
 * parameter — separate from the dashboard's ?range=hoy|ayer|7d|30d selector
 * so neither overrides the other.
 */
export async function OtrosTab({
  instanceId,
  algoliaWindow,
  algoliaOffset,
}: {
  instanceId: number;
  algoliaWindow: AlgoliaTimeWindow;
  algoliaOffset: number;
}) {
  const t = await getTranslations("dashboard");
  const supabase = await createClient();

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const algolia: AlgoliaConfig =
    (instanceRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};

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

  const fullyConfigured = isConfigured && !!adminKey;

  let noResults: NoResultRow[] = [];
  let hasMore = false;

  if (fullyConfigured) {
    const host = analyticsHost(algolia.region!);
    const { startDate, endDate } = dateRange(algoliaWindow);
    const url =
      `https://${host}/2/searches/noResults` +
      `?index=${encodeURIComponent(algolia.primary_index!)}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&limit=50` +
      `&offset=${algoliaOffset}`;

    try {
      const res = await fetch(url, {
        headers: {
          "x-algolia-application-id": algolia.app_id!,
          "x-algolia-api-key": adminKey!,
          accept: "application/json",
        },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const raw: NoResultRow[] = data.searches ?? [];
        noResults = raw.filter(
          (row) => row.search !== "<empty search>" && row.search !== "",
        );
        hasMore = raw.length === 50;
      }
    } catch {
      // Network errors non-fatal; empty state below renders.
    }
  }

  const [landings, exits] = await Promise.all([
    getTopLandingPages(instanceId, 5),
    getTopExitPages(instanceId, 5),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardHeader>
          <CardTitle>{t("noResults.title")}</CardTitle>
          <CardDescription>{t("noResults.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!fullyConfigured ? (
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
              <p
                style={{ color: "var(--muted-foreground)", fontSize: 14 }}
              >
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
              timeWindow={algoliaWindow}
              offset={algoliaOffset}
              hasMore={hasMore}
            />
          )}
        </CardContent>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        <PagesTable
          title={t("pages.topLanding")}
          rows={landings}
          valueLabel={t("pages.entrances")}
          showDelta={false}
          total={landings.reduce((s, r) => s + r.value, 0)}
        />
        <PagesTable
          title={t("pages.topExit")}
          rows={exits}
          valueLabel={t("pages.exits")}
          showDelta={false}
          total={exits.reduce((s, r) => s + r.value, 0)}
        />
      </div>
    </div>
  );
}
