import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { TIMESERIES_DAYS } from "@/lib/integrations/ga4/constants";
import {
  getActiveAlerts,
  getAlertTiles,
  getAudienceSummary,
  getDeviceMix,
  getGa4Config,
  getGeoTop,
  getSessionTimeseries,
  getTopChannels,
  getTopExitPages,
  getTopLandingPages,
  isGa4Connected,
} from "@/lib/integrations/ga4/fetchers";
import { DashboardTabs } from "../_dashboard-tabs";
import { InsightsReveal } from "@/components/dashboard/insights/_reveal";
import { RealtimeHeader } from "@/components/dashboard/insights/_realtime-header";
import { DashboardPullButton } from "@/components/dashboard/insights/_pull-button";
import {
  AlertInbox,
  type InboxItem,
} from "@/components/dashboard/insights/_alert-inbox";
import {
  AreaChartSvg,
  DeltaPill,
  DonutSplit,
  Ptable,
  SegBar,
  SoonBars,
  SoonRing,
  Sparkline,
  StackBars,
  fmtDelta,
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtSignedPct,
  type PtableRow,
  type SegRow,
  type StackRow,
} from "@/components/dashboard/insights/charts";
import "@/components/dashboard/insights/insights.css";

const CH_COLORS = [
  "var(--accent)",
  "var(--accent-2)",
  "var(--sage)",
  "var(--blue)",
  "var(--lilac)",
];
const DEVICE_COLORS = ["var(--accent)", "var(--blue)", "var(--lilac)", "var(--sage)"];

export default async function TrafficDashboardPage() {
  const t = await getTranslations("dashboard");
  const tt = await getTranslations("dashboard.traffic");

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

  const Header = (
    <>
      <div className="s-page-header" style={{ marginBottom: 20 }}>
        <h1 className="s-page-title">{t("title")}</h1>
      </div>
      <div style={{ marginBottom: 24 }}>
        <DashboardTabs />
      </div>
    </>
  );

  const connected = await isGa4Connected(instanceId);
  if (!connected) {
    return (
      <div className="s-page-content" style={{ maxWidth: "none" }}>
        {Header}
        <InsightsReveal>
          <div className="dash-head">
            <div className="head-left">
              <div className="brand">
                <span className="mk">G</span>
                <span className="nm">GRO</span>
              </div>
            </div>
          </div>
          <div className="tile connect">
            <h2>{tt("notConnected.title")}</h2>
            <p>{tt("notConnected.body")}</p>
            <Link href="/configuration/ga4">{tt("notConnected.cta")}</Link>
          </div>
        </InsightsReveal>
      </div>
    );
  }

  const [cfg, audience, series, tiles, channels, landings, exits, geo, devices, alerts] =
    await Promise.all([
      getGa4Config(instanceId),
      getAudienceSummary(instanceId),
      getSessionTimeseries(instanceId),
      getAlertTiles(instanceId),
      getTopChannels(instanceId, 5),
      getTopLandingPages(instanceId),
      getTopExitPages(instanceId),
      getGeoTop(instanceId),
      getDeviceMix(instanceId),
      getActiveAlerts(instanceId),
    ]);

  // ── Derived series for charts ──
  const sessionsSeries = series.map((p) => p.sessions);
  const engagementSeries = series.map((p) => p.engagement_rate);
  const usersSeries = series.map((p) => p.users);
  const durationSeries = series.map((p) => p.avg_session_duration_sec);
  const viewsSeries = series.map((p) => p.views_per_session);

  // ── Channel stack rows ──
  const channelTotal = channels.reduce((s, c) => s + c.sessions_today, 0);
  const channelRows: StackRow[] = channels.map((c, i) => ({
    name: c.channel,
    valueLabel: fmtInt(c.sessions_today),
    color: CH_COLORS[i % CH_COLORS.length],
    value: c.sessions_today,
  }));

  // ── Device mix rows ──
  const deviceRows: SegRow[] = devices.map((d, i) => ({
    name: d.device,
    valueLabel: fmtInt(d.sessions),
    pcLabel: fmtPct(d.share, 0),
    color: DEVICE_COLORS[i % DEVICE_COLORS.length],
    share: d.share,
  }));

  // ── Geo stack rows ──
  const geoRows: StackRow[] = geo.map((g) => ({
    name: g.country,
    valueLabel: fmtInt(g.sessions),
    color: "var(--accent)",
    value: g.sessions,
  }));

  // ── Page tables ──
  const landingRows: PtableRow[] = landings.map((p) => ({
    path: p.page_path,
    valueLabel: fmtInt(p.value),
    deltaPct: p.delta_pct,
  }));
  const exitRows: PtableRow[] = exits.map((p) => ({
    path: p.page_path,
    valueLabel: fmtInt(p.value),
    deltaPct: p.delta_pct,
  }));

  // ── Alert tiles ──
  const tileMeta: Record<string, { label: string }> = {
    sessions: { label: tt("alerts.tileSessions") },
    engagement_rate: { label: tt("alerts.tileEngagement") },
    traffic_share: { label: tt("alerts.tileTrafficShare") },
  };

  // ── Alert inbox items ──
  const metricLabel: Record<string, string> = {
    sessions: tt("alerts.metricSessions"),
    engagement_rate: tt("alerts.metricEngagement"),
    traffic_share: tt("alerts.metricTrafficShare"),
  };
  const inboxItems: InboxItem[] = alerts.map((a) => ({
    id: a.alert_id,
    title:
      (metricLabel[a.metric] ?? a.metric) +
      (a.dimension_key ? ` · ${a.dimension_key}` : ""),
    sub: tt("alerts.observed", {
      observed: Number(a.observed_value).toFixed(2),
      baseline: Number(a.baseline_value).toFixed(2),
      delta: Number(a.delta_pct).toFixed(1),
    }),
    acknowledged: a.status === "acknowledged",
  }));

  const emptyTile = (label: string, sub?: string) => (
    <div className="tile" data-col>
      <div className="tile-head">
        <span className="tile-label">{label}</span>
        {sub ? <span className="tile-sub">{sub}</span> : null}
      </div>
      <div className="tile-empty">{tt("empty")}</div>
    </div>
  );

  return (
    <div className="s-page-content" style={{ maxWidth: "none" }}>
      {Header}
      <InsightsReveal>
        {/* ── Header strip ── */}
        <div className="dash-head">
          <div className="head-left">
            <div className="brand">
              <span className="mk">G</span>
              <span className="nm">GRO</span>
            </div>
            <div className="head-divider" />
            <div className="head-prop">
              <span className="eyebrow">{tt("header.property")}</span>
              <span className="name">
                {cfg?.property_id ? `#${cfg.property_id}` : "—"}
              </span>
            </div>
            <div className="head-divider" />
            <div className="chip-row">
              <span className="chip active">
                {tt("header.windowDays", { n: TIMESERIES_DAYS })}
              </span>
              <span className="chip">{tt("header.windowBaseline")}</span>
            </div>
          </div>
          <div className="head-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <DashboardPullButton />
            <RealtimeHeader label={tt("header.realtime")} />
          </div>
        </div>

        {/* ═══ AUDIENCIA ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.audience")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.audienceMeta")}</span>
        </div>

        {audience.hasData ? (
          <>
            {/* Users composition */}
            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="tile-head">
                <span className="tile-label">{tt("tiles.usersComposition")}</span>
                <span className="tile-sub">{tt("tiles.usersSub")}</span>
              </div>
              <div className="ringwrap">
                <div className="ring">
                  <DonutSplit
                    frac={audience.users > 0 ? audience.newUsers / audience.users : 0}
                    colorA="var(--g-light)"
                    colorB="var(--g-dark)"
                  />
                  <div className="c">
                    <span className="v">{fmtInt(audience.users)}</span>
                    <span
                      className={`cd ${audience.usersDeltaPct >= 0 ? "up" : "down"}`}
                    >
                      {fmtDelta(audience.usersDeltaPct)}
                    </span>
                  </div>
                </div>
                <div className="dleg">
                  <div className="r">
                    <span className="dot" style={{ background: "var(--g-light)" }} />
                    <span className="nm">{tt("tiles.newUsers")}</span>
                    <span className="vv">{fmtInt(audience.newUsers)}</span>
                    <span
                      className={`dd ${audience.newUsersDeltaPct >= 0 ? "up" : "down"}`}
                    >
                      {fmtDelta(audience.newUsersDeltaPct)}
                    </span>
                  </div>
                  <div className="r">
                    <span className="dot" style={{ background: "var(--g-dark)" }} />
                    <span className="nm">{tt("tiles.returningUsers")}</span>
                    <span className="vv">{fmtInt(audience.returningUsers)}</span>
                    <span
                      className={`dd ${
                        audience.returningUsersDeltaPct >= 0 ? "up" : "down"
                      }`}
                    >
                      {fmtDelta(audience.returningUsersDeltaPct)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sessions engagement */}
            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="tile-head">
                <span className="tile-label">{tt("tiles.sessionsEngagement")}</span>
                <span className="tile-sub">
                  {tt("tiles.engagementRateSub", {
                    pct: fmtPct(audience.engagementRate),
                  })}
                </span>
              </div>
              <div className="ringwrap">
                <div className="ring">
                  <DonutSplit
                    frac={audience.engagementRate}
                    colorA="var(--accent)"
                    colorB="#5b5b63"
                  />
                  <div className="c">
                    <span className="v">{fmtInt(audience.sessions)}</span>
                    <span
                      className={`cd ${audience.sessionsDeltaPct >= 0 ? "up" : "down"}`}
                    >
                      {fmtDelta(audience.sessionsDeltaPct)}
                    </span>
                  </div>
                </div>
                <div className="dleg">
                  <div className="r">
                    <span className="dot" style={{ background: "var(--accent)" }} />
                    <span className="nm">{tt("tiles.engaged")}</span>
                    <span className="vv">{fmtInt(audience.engagedSessions)}</span>
                    <span className="pc">{fmtPct(audience.engagementRate, 0)}</span>
                  </div>
                  <div className="r">
                    <span className="dot" style={{ background: "#5b5b63" }} />
                    <span className="nm">{tt("tiles.nonEngaged")}</span>
                    <span className="vv">{fmtInt(audience.nonEngagedSessions)}</span>
                    <span className="pc">{fmtPct(1 - audience.engagementRate, 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Per-session depth */}
            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="tile-head">
                <span className="tile-label">{tt("tiles.perSession")}</span>
              </div>
              <div className="depth">
                <div className="drow">
                  <div className="dtop">
                    <span className="dname">{tt("tiles.avgDuration")}</span>
                    <DeltaPill pct={audience.durationDeltaPct} />
                  </div>
                  <div className="dval">
                    <span className="vn">
                      {fmtDuration(audience.avgSessionDurationSec)}
                    </span>
                  </div>
                  <Sparkline
                    values={durationSeries}
                    color={audience.durationDeltaPct >= 0 ? "var(--accent)" : "#fca5a5"}
                  />
                </div>
                <div className="drow">
                  <div className="dtop">
                    <span className="dname">{tt("tiles.viewsPerSession")}</span>
                    <DeltaPill pct={audience.viewsDeltaPct} />
                  </div>
                  <div className="dval">
                    <span className="vn">{audience.viewsPerSession.toFixed(1)}</span>
                  </div>
                  <Sparkline
                    values={viewsSeries}
                    color={audience.viewsDeltaPct >= 0 ? "var(--accent)" : "#fca5a5"}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="tile" style={{ gridColumn: "span 12" }}>
            <div className="tile-empty">{tt("empty")}</div>
          </div>
        )}

        {/* ═══ ADQUISICIÓN ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.acquisition")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.acquisitionMeta")}</span>
        </div>

        {/* Channels */}
        {channelRows.length > 0 ? (
          <div className="tile" data-col style={{ gridColumn: "span 4" }}>
            <div className="tile-head">
              <span className="tile-label">{tt("tiles.sessionsByChannel")}</span>
              <span className="tile-sub">
                {tt("tiles.totalSessions", { n: fmtInt(channelTotal) })}
              </span>
            </div>
            <StackBars rows={channelRows} />
          </div>
        ) : (
          emptyTile(tt("tiles.sessionsByChannel"))
        )}

        {/* Top landing pages */}
        <div className="tile" data-col style={{ gridColumn: "span 5" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("tiles.topLandingPages")}</span>
            <span className="tile-sub">{tt("tiles.byEntrances")}</span>
          </div>
          {landingRows.length > 0 ? (
            <Ptable
              headers={[tt("tiles.colPage"), tt("tiles.colEntrances"), tt("tiles.colDelta")]}
              rows={landingRows}
            />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        {/* Device mix */}
        <div className="tile" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("tiles.deviceMix")}</span>
          </div>
          {deviceRows.length > 0 ? (
            <SegBar rows={deviceRows} />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        {/* ═══ PÁGINAS Y GEOGRAFÍA ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.pagesGeo")}</span>
          <span className="rule" />
        </div>

        {/* Exit pages */}
        <div className="tile" data-col style={{ gridColumn: "span 6" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("tiles.topExitPages")}</span>
            <span className="tile-sub">{tt("tiles.byExits")}</span>
          </div>
          {exitRows.length > 0 ? (
            <Ptable
              headers={[tt("tiles.colPage"), tt("tiles.colExits"), tt("tiles.colDelta")]}
              rows={exitRows}
            />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        {/* Geo */}
        <div className="tile" data-col style={{ gridColumn: "span 6" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("tiles.geo")}</span>
            <span className="tile-sub">{tt("tiles.byCountry")}</span>
          </div>
          {geoRows.length > 0 ? (
            <StackBars rows={geoRows} />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        {/* ═══ CONVERSIONES Y EMBUDOS (Próximamente) ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.conversions")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.conversionsMeta")}</span>
        </div>

        <div className="tile soon" data-col style={{ gridColumn: "span 6" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.purchaseFunnel")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonBars n={5} />
        </div>
        <div className="tile soon" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.conversionRate")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonRing />
        </div>
        <div className="tile soon" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.checkoutCompletion")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonRing />
        </div>

        {/* ═══ OBJETIVOS E INGRESOS (Próximamente) ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.revenue")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.revenueMeta")}</span>
        </div>

        <div className="tile soon" data-col style={{ gridColumn: "span 4" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.goalCompletions")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonBars n={3} />
        </div>
        <div className="tile soon" data-col style={{ gridColumn: "span 4" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.revenueByChannel")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonBars n={4} />
        </div>
        <div className="tile soon" data-col style={{ gridColumn: "span 4" }}>
          <div className="tile-head">
            <span className="tile-label">{tt("soon.cartAbandonment")}</span>
            <span className="soon-badge">{tt("soon.badge")}</span>
          </div>
          <SoonRing />
        </div>

        {/* ═══ TENDENCIAS ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.trends")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.trendsMeta", { n: TIMESERIES_DAYS })}</span>
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">
                {tt("trends.sessions", { n: TIMESERIES_DAYS })}
              </span>
              <div className="chart-figure">
                <span className="v">{fmtInt(audience.sessions)}</span>
                <DeltaPill
                  pct={audience.sessionsDeltaPct}
                  label={fmtSignedPct(audience.sessionsDeltaPct)}
                />
              </div>
            </div>
          </div>
          {sessionsSeries.length > 0 ? (
            <AreaChartSvg values={sessionsSeries} color="var(--accent)" />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">
                {tt("trends.engagement", { n: TIMESERIES_DAYS })}
              </span>
              <div className="chart-figure">
                <span className="v">{fmtPct(audience.engagementRate)}</span>
                <DeltaPill
                  pct={audience.engagementDeltaPp}
                  label={`${audience.engagementDeltaPp >= 0 ? "+" : ""}${audience.engagementDeltaPp.toFixed(1)}pp`}
                />
              </div>
            </div>
          </div>
          {engagementSeries.length > 0 ? (
            <AreaChartSvg values={engagementSeries} color="var(--sage)" />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">
                {tt("trends.users", { n: TIMESERIES_DAYS })}
              </span>
              <div className="chart-figure">
                <span className="v">{fmtInt(audience.users)}</span>
                <DeltaPill
                  pct={audience.usersDeltaPct}
                  label={fmtSignedPct(audience.usersDeltaPct)}
                />
              </div>
            </div>
          </div>
          {usersSeries.length > 0 ? (
            <AreaChartSvg values={usersSeries} color="var(--blue)" />
          ) : (
            <div className="tile-empty">{tt("empty")}</div>
          )}
        </div>

        {/* ═══ ALERTAS ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.alerts")}</span>
          <span className="rule" />
        </div>

        {tiles.map((tile) => {
          const firing = tile.status === "firing";
          const value =
            tile.metric === "engagement_rate"
              ? fmtPct(tile.current)
              : tile.metric === "traffic_share"
                ? "—"
                : fmtInt(tile.current);
          const baseline =
            tile.metric === "engagement_rate"
              ? fmtPct(tile.baseline)
              : tile.metric === "traffic_share"
                ? "—"
                : fmtInt(tile.baseline);
          return (
            <div
              key={tile.metric}
              className={`tile alert-tile${firing ? " firing" : ""}`}
              data-col
              style={{ gridColumn: "span 4" }}
            >
              <div className="tile-head">
                <span className="tile-label">{tileMeta[tile.metric].label}</span>
                <span className={`alert-status ${firing ? "firing" : "ok"}`}>
                  {firing ? tt("alerts.statusFiring") : tt("alerts.statusOk")}
                </span>
              </div>
              <span className="av">{value}</span>
              <span className="tile-sub" style={{ textAlign: "left", marginTop: 4 }}>
                {tile.metric === "traffic_share"
                  ? tt("alerts.trafficShareHint")
                  : tt("alerts.vsBaseline", { value: baseline })}
              </span>
            </div>
          );
        })}

        {/* Active alerts inbox */}
        <div className="tile inbox">
          <div className="tile-head">
            <span className="tile-label">{tt("alerts.inboxTitle")}</span>
            <span className="tile-sub">{inboxItems.length}</span>
          </div>
          {inboxItems.length > 0 ? (
            <AlertInbox
              items={inboxItems}
              ackLabel={tt("alerts.acknowledge")}
              ackedLabel={tt("alerts.acknowledged")}
            />
          ) : (
            <div className="tile-empty">{tt("alerts.inboxEmpty")}</div>
          )}
        </div>
      </InsightsReveal>
    </div>
  );
}
