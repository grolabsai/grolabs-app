import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  isDashboardRange,
  isGa4Connected,
  type DashboardRange,
} from "@/lib/integrations/ga4/fetchers";
import { TimeRangeSelector } from "@/components/dashboard/TimeRangeSelector";
import { ResumenTab } from "./_resumen-tab";
import { OtrosTab } from "./_otros-tab";

type DashTab = "resumen" | "otros";

function isTab(v: unknown): v is DashTab {
  return v === "resumen" || v === "otros";
}

type AlgoliaWindow = "24h" | "7d" | "30d";
function isAlgoliaWindow(v: unknown): v is AlgoliaWindow {
  return v === "24h" || v === "7d" || v === "30d";
}

/**
 * Dashboard landing — multi-tab cockpit.
 *
 * Resumen   → KPI grid + traffic sources + alerts inbox (Stage 2)
 * Otros     → existing Algolia no-results table (verbatim) + GA4 top pages
 *
 * Two coexisting query params, each tied to a different surface:
 *   ?range=hoy|ayer|7d|30d   → dashboard-wide time range (Resumen tab)
 *   ?window=24h|7d|30d        → Algolia table dropdown (Otros tab, legacy)
 *   ?offset=N                 → Algolia table pagination (Otros tab, legacy)
 *   ?tab=resumen|otros        → which tab is active
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    range?: string;
    window?: string;
    offset?: string;
  }>;
}) {
  const t = await getTranslations("dashboard");
  const params = await searchParams;
  const tab: DashTab = isTab(params.tab) ? params.tab : "resumen";
  const range: DashboardRange = isDashboardRange(params.range)
    ? params.range
    : "7d";
  const algoliaWindow: AlgoliaWindow = isAlgoliaWindow(params.window)
    ? params.window
    : "7d";
  const algoliaOffset = Math.max(0, parseInt(params.offset ?? "0", 10) || 0);

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

  const ga4Connected = await isGa4Connected(instanceId);

  function tabHref(target: DashTab): string {
    const next = new URLSearchParams();
    next.set("tab", target);
    if (range !== "7d") next.set("range", range);
    return `/dashboard?${next.toString()}`;
  }

  const tabBaseStyle: React.CSSProperties = {
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 400,
    color: "var(--s-text-secondary)",
    borderBottom: "2px solid transparent",
    textDecoration: "none",
    display: "inline-block",
  };
  const tabActiveStyle: React.CSSProperties = {
    color: "var(--scout-accent-800)",
    borderBottomColor: "var(--scout-accent)",
    fontWeight: 500,
  };

  return (
    <div className="s-page-content">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 500,
              marginBottom: 4,
              letterSpacing: "-0.02em",
            }}
          >
            {t("title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
            {t("subtitle")}
          </div>
        </div>
        <TimeRangeSelector current={range} />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "0.5px solid var(--s-border)",
          marginBottom: 24,
        }}
      >
        <Link
          href={tabHref("resumen")}
          style={{
            ...tabBaseStyle,
            ...(tab === "resumen" ? tabActiveStyle : {}),
          }}
        >
          {t("tabs.resumen")}
        </Link>
        <Link
          href={tabHref("otros")}
          style={{
            ...tabBaseStyle,
            ...(tab === "otros" ? tabActiveStyle : {}),
          }}
        >
          {t("tabs.otros")}
        </Link>
      </div>

      {tab === "resumen" ? (
        <ResumenTab
          instanceId={instanceId}
          range={range}
          ga4Connected={ga4Connected}
        />
      ) : (
        <OtrosTab
          instanceId={instanceId}
          algoliaWindow={algoliaWindow}
          algoliaOffset={algoliaOffset}
        />
      )}
    </div>
  );
}
