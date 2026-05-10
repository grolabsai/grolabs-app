import { getTranslations } from "next-intl/server";
import { Search, TrendingUp } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import {
  getActiveAlerts,
  getDashboardKpiSummary,
  getTrafficSourcesAggregated,
  type DashboardRange,
} from "@/lib/integrations/ga4/fetchers";
import { getNoResultsSummary } from "@/lib/dashboard/no-results-summary";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { TrafficSourcesBar } from "@/components/dashboard/TrafficSourcesBar";
import { AlertsStrip } from "@/components/dashboard/AlertsStrip";
import { AlertsInbox } from "@/components/dashboard/AlertsInbox";
import { UserBreakdown } from "@/components/dashboard/UserBreakdown";
import type { Ga4Alert } from "@/lib/integrations/ga4/types";

function timeAgoEs(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `Hace ${diff}s`;
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  return `Hace ${days}d`;
}

/**
 * "Resumen" tab — KPI grid + traffic sources + alerts.
 *
 * Three search-side cards (one with data, two unavailable placeholders),
 * three traffic-side cards from GA4, full-width traffic sources stacked
 * bar, and the alerts inbox at the bottom.
 */
export async function ResumenTab({
  instanceId,
  range,
  ga4Connected,
}: {
  instanceId: number;
  range: DashboardRange;
  ga4Connected: boolean;
}) {
  const t = await getTranslations("dashboard");

  const [noResults, kpis, sources, alerts] = await Promise.all([
    getNoResultsSummary(instanceId, range),
    ga4Connected
      ? getDashboardKpiSummary(instanceId, range)
      : Promise.resolve(null),
    ga4Connected
      ? getTrafficSourcesAggregated(instanceId, range)
      : Promise.resolve({ segments: [], total: 0 }),
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

  const sectionLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--s-text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 500,
    margin: "20px 0 12px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <AlertsStrip
        alerts={alerts}
        title={t("alerts.activeTitle")}
        describe={describeAlert}
        timeAgo={timeAgoEs}
      />

      {/* Search metrics */}
      <div style={sectionLabelStyle}>
        <Icon icon={Search} size={12} />
        {t("sections.search")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 4,
        }}
      >
        <KpiCard
          label={t("kpi.noResults.label")}
          meta={t("kpi.noResults.meta")}
          thresholdLabel={t("kpi.noResults.threshold")}
          status={noResults.configured ? "ok" : "unavailable"}
          value={noResults.configured ? noResults.count.toLocaleString() : undefined}
          trend={
            noResults.configured && noResults.countPrev > 0
              ? {
                  value: noResults.deltaPct,
                  unit: "%",
                  decimals: 0,
                  invertedGood: true,
                }
              : undefined
          }
          spark={noResults.spark}
          sparkColor="var(--s-success)"
        />
        <KpiCard
          label={t("kpi.searchConversion.label")}
          meta={t("kpi.searchConversion.meta")}
          thresholdLabel={t("kpi.searchConversion.threshold")}
          status="unavailable"
        />
        <KpiCard
          label={t("kpi.clickPosition.label")}
          meta={t("kpi.clickPosition.meta")}
          thresholdLabel={t("kpi.clickPosition.threshold")}
          status="unavailable"
        />
      </div>

      {/* Traffic metrics */}
      <div style={sectionLabelStyle}>
        <Icon icon={TrendingUp} size={12} />
        {t("sections.traffic")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label={t("kpi.sessions.label")}
          meta={t("kpi.sessions.meta")}
          thresholdLabel={t("kpi.sessions.threshold")}
          status={
            !ga4Connected
              ? "unavailable"
              : kpis?.sessions.status === "firing"
                ? "firing"
                : "ok"
          }
          alertCount={kpis?.sessions.status === "firing" ? 1 : 0}
          value={kpis ? kpis.sessions.current.toLocaleString() : undefined}
          trend={
            kpis
              ? {
                  value: kpis.sessions.deltaPct,
                  unit: "%",
                  decimals: 0,
                }
              : undefined
          }
          spark={kpis?.sessions.spark}
          sparkColor={
            kpis?.sessions.status === "firing"
              ? "var(--s-danger)"
              : "var(--scout-accent)"
          }
        />
        <KpiCard
          label={t("kpi.engagement.label")}
          meta={t("kpi.engagement.meta")}
          thresholdLabel={t("kpi.engagement.threshold")}
          status={
            !ga4Connected
              ? "unavailable"
              : kpis?.engagement.status === "firing"
                ? "firing"
                : "ok"
          }
          alertCount={kpis?.engagement.status === "firing" ? 1 : 0}
          value={
            kpis
              ? `${(kpis.engagement.current * 100).toFixed(1)}%`
              : undefined
          }
          trend={
            kpis
              ? {
                  value: kpis.engagement.deltaPct,
                  unit: "pp",
                  decimals: 1,
                }
              : undefined
          }
          spark={kpis?.engagement.spark}
          sparkColor={
            kpis?.engagement.status === "firing"
              ? "var(--s-danger)"
              : "var(--s-success)"
          }
        />
        <KpiCard
          label={t("kpi.users.label")}
          meta={t("kpi.users.meta")}
          thresholdLabel={t("kpi.users.threshold")}
          status={!ga4Connected ? "unavailable" : "ok"}
          value={
            kpis ? kpis.users.current.toLocaleString() : undefined
          }
          trend={
            kpis ? { value: kpis.users.deltaPct, unit: "%" } : undefined
          }
          footerSlot={
            kpis ? (
              <UserBreakdown
                newUsers={kpis.users.newUsers}
                returningUsers={kpis.users.returningUsers}
                newPct={kpis.users.newPct}
                returningPct={kpis.users.returningPct}
                newLabel={t("kpi.users.new")}
                returningLabel={t("kpi.users.returning")}
              />
            ) : undefined
          }
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <TrafficSourcesBar
          title={t("trafficSources.title")}
          segments={sources.segments}
          total={sources.total}
          detailHref="/dashboard/traffic"
          detailLabel={t("trafficSources.viewDetail")}
        />
      </div>

      <AlertsInbox
        alerts={alerts}
        describe={describeAlert}
        timeAgo={timeAgoEs}
      />
    </div>
  );
}
