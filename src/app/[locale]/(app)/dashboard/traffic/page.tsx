import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveAlerts,
  getDashboardKpiSummary,
  getGa4Config,
  getSessionTimeseries,
  getTopExitPages,
  getTopLandingPages,
  getTrafficSourcesAggregated,
  isDashboardRange,
  isGa4Connected,
  type DashboardRange,
} from "@/lib/integrations/ga4/fetchers";
import { LiveActiveUsersCompact } from "@/components/dashboard/LiveActiveUsersCompact";
import { AlertTile } from "@/components/dashboard/AlertTile";
import { SessionsLineChart } from "@/components/dashboard/SessionsLineChart";
import { EngagementLineChart } from "@/components/dashboard/EngagementLineChart";
import { TrafficSourcesBar } from "@/components/dashboard/TrafficSourcesBar";
import { PagesTable } from "@/components/dashboard/PagesTable";
import { AlertsInbox } from "@/components/dashboard/AlertsInbox";
import { TimeRangeSelector } from "@/components/dashboard/TimeRangeSelector";
import { TrafficEmptyState } from "./_empty-state";
import type { Ga4Alert } from "@/lib/integrations/ga4/types";

function timeAgoEs(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `Hace ${diff}s`;
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`;
  return `Hace ${Math.floor(diff / 86400)}d`;
}

export default async function TrafficDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const t = await getTranslations("traffic");

  const params = await searchParams;
  const range: DashboardRange = isDashboardRange(params.range)
    ? params.range
    : "7d";

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

  const connected = await isGa4Connected(instanceId);
  if (!connected) {
    return <TrafficEmptyState />;
  }

  const [cfg, kpis, timeseries, sources, landings, exits, alerts] =
    await Promise.all([
      getGa4Config(instanceId),
      getDashboardKpiSummary(instanceId, range),
      getSessionTimeseries(instanceId),
      getTrafficSourcesAggregated(instanceId, range),
      getTopLandingPages(instanceId, 5),
      getTopExitPages(instanceId, 5),
      getActiveAlerts(instanceId),
    ]);

  function describeAlert(a: Ga4Alert): { headline: string; detail: string } {
    if (a.metric === "sessions") {
      const direction = a.delta_pct < 0 ? "cayeron" : "subieron";
      return {
        headline: `Sesiones ${direction} ${Math.abs(Number(a.delta_pct)).toFixed(0)}% vs promedio 7 días`,
        detail: `${Number(a.observed_value).toFixed(0)} sesiones vs ${Number(a.baseline_value).toFixed(0)} promedio.`,
      };
    }
    if (a.metric === "engagement_rate") {
      return {
        headline: `Tasa de engagement bajó ${Math.abs(Number(a.delta_pct)).toFixed(1)}pp vs promedio 7 días`,
        detail: `${(Number(a.observed_value) * 100).toFixed(1)}% vs ${(Number(a.baseline_value) * 100).toFixed(1)}% promedio.`,
      };
    }
    return {
      headline: `Mix de fuentes cambió ${Math.abs(Number(a.delta_pct)).toFixed(1)}pp`,
      detail: a.dimension_key ?? "",
    };
  }

  // Derived comparisons for the alert tiles
  const sessionsTile = kpis
    ? {
        value: kpis.sessions.current.toLocaleString(),
        status: (kpis.sessions.status === "firing" ? "critical" : "ok") as
          | "critical"
          | "ok",
        comparisons: [
          {
            label: "vs promedio 7d:",
            value: `${kpis.sessions.deltaPct >= 0 ? "+" : ""}${kpis.sessions.deltaPct.toFixed(1)}%`,
            tone: (kpis.sessions.deltaPct < 0 ? "negative" : "positive") as
              | "positive"
              | "negative",
          },
        ],
        spark: kpis.sessions.spark,
      }
    : null;

  const engagementTile = kpis
    ? {
        value: `${(kpis.engagement.current * 100).toFixed(1)}%`,
        status: (kpis.engagement.status === "firing" ? "critical" : "ok") as
          | "critical"
          | "ok",
        comparisons: [
          {
            label: "vs promedio 7d:",
            value: `${kpis.engagement.deltaPct >= 0 ? "+" : ""}${kpis.engagement.deltaPct.toFixed(1)}pp`,
            tone: (kpis.engagement.deltaPct < 0 ? "negative" : "positive") as
              | "positive"
              | "negative",
          },
        ],
        spark: kpis.engagement.spark,
      }
    : null;

  return (
    <div className="s-page-content">
      <div style={{ fontSize: 12, color: "var(--s-text-tertiary)", marginBottom: 16 }}>
        <Link
          href="/dashboard"
          style={{ color: "var(--s-text-secondary)", textDecoration: "none" }}
        >
          {t("breadcrumb.dashboard")}
        </Link>
        <span style={{ margin: "0 6px" }}>›</span>
        <span>{t("breadcrumb.current")}</span>
      </div>

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
            {t("subtitle", {
              property: cfg?.property_id ? `GA4-${cfg.property_id}` : "—",
            })}
          </div>
        </div>
        <TimeRangeSelector current={range} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <LiveActiveUsersCompact />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
          }}
        >
          {sessionsTile ? (
            <AlertTile
              label={t("tiles.sessions")}
              value={sessionsTile.value}
              status={sessionsTile.status}
              spark={sessionsTile.spark}
              comparisons={sessionsTile.comparisons}
            />
          ) : null}
          {engagementTile ? (
            <AlertTile
              label={t("tiles.engagement")}
              value={engagementTile.value}
              status={engagementTile.status}
              spark={engagementTile.spark}
              comparisons={engagementTile.comparisons}
            />
          ) : null}
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-lg)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--s-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 500,
              }}
            >
              {t("tiles.trafficSources")}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 4,
              }}
            >
              {sources.segments.slice(0, 4).map((s) => (
                <div
                  key={s.channel}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      color: "var(--s-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.channel}
                  </span>
                  <span
                    style={{
                      color: "var(--s-text-tertiary)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {s.sessions.toLocaleString()} ·{" "}
                    {Math.round(s.share * 100)}%
                  </span>
                </div>
              ))}
              {sources.segments.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--s-text-tertiary)",
                  }}
                >
                  {t("tiles.noSources")}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-lg)",
              padding: 20,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t("charts.sessions.title")}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}
              >
                {t("charts.sessions.subtitle")}
              </div>
            </div>
            <SessionsLineChart data={timeseries} />
          </div>
          <div
            style={{
              background: "var(--s-surface)",
              border: "0.5px solid var(--s-border)",
              borderRadius: "var(--s-radius-lg)",
              padding: 20,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t("charts.engagement.title")}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}
              >
                {t("charts.engagement.subtitle")}
              </div>
            </div>
            <EngagementLineChart data={timeseries} />
          </div>
        </div>

        <TrafficSourcesBar
          title={t("trafficSources.title")}
          segments={sources.segments}
          total={sources.total}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <PagesTable
            title={t("topLanding.title")}
            rows={landings}
            valueLabel={t("topLanding.value")}
            showDelta
          />
          <PagesTable
            title={t("topExit.title")}
            rows={exits}
            valueLabel={t("topExit.value")}
            showDelta
          />
        </div>

        <AlertsInbox
          alerts={alerts}
          describe={describeAlert}
          timeAgo={timeAgoEs}
        />
      </div>
    </div>
  );
}
