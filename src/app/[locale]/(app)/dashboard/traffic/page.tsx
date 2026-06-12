import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { TIMESERIES_DAYS } from "@/lib/integrations/ga4/constants";
import {
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
          <div className="tile connect">
            <h2>{tt("notConnected.title")}</h2>
            <p>{tt("notConnected.body")}</p>
            <Link href="/configuration/ga4">{tt("notConnected.cta")}</Link>
          </div>
        </InsightsReveal>
      </div>
    );
  }

  const [cfg, audience, series, channels, landings, exits, geo, devices] =
    await Promise.all([
      getGa4Config(instanceId),
      getAudienceSummary(instanceId),
      getSessionTimeseries(instanceId),
      getTopChannels(instanceId, 5),
      getTopLandingPages(instanceId),
      getTopExitPages(instanceId),
      getGeoTop(instanceId),
      getDeviceMix(instanceId),
    ]);

  // ── Data freshness: the dashboard only shows finalized days (through
  // yesterday UTC); today is excluded so a partial day never reads as a drop. ──
  const dataThrough = new Date();
  dataThrough.setUTCHours(0, 0, 0, 0);
  dataThrough.setUTCDate(dataThrough.getUTCDate() - 1);
  const dataThroughLabel = dataThrough.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const updatedLabel = cfg?.last_pull_at
    ? `${new Date(cfg.last_pull_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })} UTC`
    : null;

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

  // ── Page tables ── ("/" renders as "Home" rather than a bare slash)
  const prettyPath = (p: string) => (p === "/" || p === "" ? tt("tiles.homePage") : p);
  const landingRows: PtableRow[] = landings.map((p) => ({
    path: prettyPath(p.page_path),
    valueLabel: fmtInt(p.value),
    deltaPct: p.delta_pct,
  }));
  const exitRows: PtableRow[] = exits.map((p) => ({
    path: prettyPath(p.page_path),
    valueLabel: fmtInt(p.value),
    deltaPct: p.delta_pct,
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
            <div className="head-prop">
              <span className="eyebrow">{tt("header.property")}</span>
              <span className="name">
                {cfg?.property_id ? `#${cfg.property_id}` : "—"}
              </span>
            </div>
          </div>
          <div className="head-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <DashboardPullButton />
            <RealtimeHeader label={tt("header.realtime")} />
          </div>
        </div>

        {/* Data freshness — one continuous line (full grid width), never wraps. */}
        <div
          style={{
            gridColumn: "span 12",
            fontSize: 11,
            color: "var(--t3)",
            margin: "0 0 8px",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {updatedLabel
            ? tt("header.freshness", { date: dataThroughLabel, updated: updatedLabel })
            : tt("header.freshnessNoData", { date: dataThroughLabel })}
        </div>

        {/* ═══ AUDIENCIA ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.keyMetrics")}</span>
          <span className="rule" />
          <span className="meta">{tt("sections.keyMetricsMeta")}</span>
        </div>

        {audience.hasData ? (
          <>
            {/* Row 1 — Sessions / Avg session duration / Page views per session.
                Big number (yesterday) + delta (vs prior 7-day avg) + sparkline. */}
            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="chart-head">
                <div>
                  <span className="tile-label">{tt("kpi.sessions")}</span>
                  <div className="chart-figure">
                    <span className="v">{fmtInt(audience.sessions)}</span>
                    <DeltaPill
                      pct={audience.sessionsDeltaPct}
                      label={fmtSignedPct(audience.sessionsDeltaPct)}
                    />
                  </div>
                </div>
              </div>
              <Sparkline values={sessionsSeries} color="var(--accent)" />
            </div>

            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="chart-head">
                <div>
                  <span className="tile-label">{tt("kpi.avgDuration")}</span>
                  <div className="chart-figure">
                    <span className="v">{fmtDuration(audience.avgSessionDurationSec)}</span>
                    <DeltaPill
                      pct={audience.durationDeltaPct}
                      label={fmtSignedPct(audience.durationDeltaPct)}
                    />
                  </div>
                </div>
              </div>
              <Sparkline values={durationSeries} color="var(--sage)" />
            </div>

            <div className="tile" data-col style={{ gridColumn: "span 4" }}>
              <div className="chart-head">
                <div>
                  <span className="tile-label">{tt("kpi.viewsPerSession")}</span>
                  <div className="chart-figure">
                    <span className="v">{audience.viewsPerSession.toFixed(1)}</span>
                    <DeltaPill
                      pct={audience.viewsDeltaPct}
                      label={fmtSignedPct(audience.viewsDeltaPct)}
                    />
                  </div>
                </div>
              </div>
              <Sparkline values={viewsSeries} color="var(--blue)" />
            </div>

            {/* Row 2 — Engagement over time / Users over time / New vs returning. */}
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

            {/* New vs returning users */}
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
          </>
        ) : (
          <div className="tile" style={{ gridColumn: "span 12" }}>
            <div className="tile-empty">{tt("empty")}</div>
          </div>
        )}

        {/* ═══ PÁGINAS ═══ */}
        <div className="sec-label">
          <span className="txt">{tt("sections.pagesGeo")}</span>
          <span className="rule" />
        </div>

        {/* Top landing pages — entry */}
        <div className="tile" data-col style={{ gridColumn: "span 6" }}>
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

        {/* Exit pages — exit */}
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

        {/* Geo — grouped with channels + device */}
        <div className="tile" data-col style={{ gridColumn: "span 5" }}>
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

        {/* Alerts removed 2026-06-12 — no thresholds/rules defined yet; alert
            management is an open design question (see ga4-integration.md §15). */}

        {/* ═══ CONVERSIONES Y EMBUDOS (Próximamente) — pinned to the bottom ═══ */}
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

        {/* ═══ OBJETIVOS E INGRESOS (Próximamente) — pinned to the bottom ═══ */}
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
      </InsightsReveal>
    </div>
  );
}
