import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  getOverviewMetrics,
  getFunnelSeries,
  getUserBreakdown,
  metric,
  type OverviewPeriod,
} from "@/lib/analytics/overview";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { DashboardTabs } from "../_dashboard-tabs";
import { InsightsReveal } from "@/components/dashboard/insights/_reveal";
import {
  AreaChartSvg,
  Sparkline,
  DonutMulti,
  DeltaPill,
  fmtInt,
  fmtPct,
  fmtMoney,
  fmtDelta,
  fmtPp,
  deltaColor,
} from "@/components/dashboard/insights/charts";
import "@/components/dashboard/insights/insights.css";

const PERIODS: { days: OverviewPeriod; key: string }[] = [
  { days: 1, key: "yesterday" },
  { days: 7, key: "d7" },
  { days: 15, key: "d15" },
  { days: 30, key: "d30" },
];

function parsePeriod(raw: string | undefined): OverviewPeriod {
  const n = Number(raw);
  return ([1, 7, 15, 30] as const).includes(n as OverviewPeriod)
    ? (n as OverviewPeriod)
    : 30;
}

export default async function OverviewDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const t = await getTranslations("dashboard");
  const to = await getTranslations("dashboard.overview");
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);

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

  const [m, funnelSeries, users] = await Promise.all([
    getOverviewMetrics(instanceId, period),
    getFunnelSeries(instanceId, period),
    getUserBreakdown(instanceId, period),
  ]);

  const sales = metric(m, "total_sales");
  const orders = metric(m, "orders");
  const aov = metric(m, "aov");
  const items = metric(m, "avg_items_per_order");
  const sessionConv = metric(m, "session_conversion");
  const searchVol = metric(m, "search_volume");
  const avgClick = metric(m, "avg_click_position");
  const cartConv = metric(m, "cart_to_checkout");
  const noResult = metric(m, "no_result_rate");
  const ctr = metric(m, "search_ctr");
  const searchToPurchase = metric(m, "search_to_purchase");

  // ── Capture funnel (our spine): sessions → searches → clicks → cart.
  // Counts come from existing metrics' populations (no extra metrics needed):
  // sessions = session_conversion denominator; clicks = avg_click_position
  // denominator; cart adds = cart_to_checkout denominator. Sessions + searches
  // are the absolute anchors; clicks/cart show stage % (of searches).
  const fSessions = sessionConv.den;
  const fSearches = searchVol.value;
  const fClicks = avgClick.den;
  const fCart = cartConv.den;
  // Both measured against searches (the base). Cart adds are un-gated (they come
  // from anywhere, not only search-result clicks), so "cart ÷ clicks" can exceed
  // 100% — we use "cart ÷ searches" (the search-to-cart reach) instead. The fence.
  const clickRate = fSearches > 0 ? fClicks / fSearches : 0;
  const cartReach = fSearches > 0 ? fCart / fSearches : 0;

  // Funnel deltas vs the equal prior period. Counts use prior denominator/value;
  // the two rates compare current vs prior pooled rate (as points).
  const pct = (cur: number, prior: number) => (prior > 0 ? ((cur - prior) / prior) * 100 : 0);
  const priorSearches = searchVol.prior;
  const sessionsDeltaPct = pct(fSessions, sessionConv.priorDen);
  const searchesDeltaPct = searchVol.deltaPct;
  const clickRatePrior = priorSearches > 0 ? avgClick.priorDen / priorSearches : 0;
  const cartReachPrior = priorSearches > 0 ? cartConv.priorDen / priorSearches : 0;
  const clickRateDeltaPp = (clickRate - clickRatePrior) * 100;
  const cartReachDeltaPp = (cartReach - cartReachPrior) * 100;

  // Closed-period freshness label (through yesterday UTC).
  const through = new Date();
  through.setUTCHours(0, 0, 0, 0);
  through.setUTCDate(through.getUTCDate() - 1);
  const throughLabel = through.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const PeriodChips = (
    <div className="ov-chips">
      {PERIODS.map((p) => (
        <Link
          key={p.days}
          href={`/dashboard/overview?period=${p.days}` as Route}
          className={`ov-chip${p.days === period ? " active" : ""}`}
        >
          {to(`period.${p.key}`)}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="s-page-content" style={{ maxWidth: "none" }}>
      <div className="s-page-header" style={{ marginBottom: 20 }}>
        <h1 className="s-page-title">{t("title")}</h1>
      </div>
      <div style={{ marginBottom: 24 }}>
        <DashboardTabs />
      </div>

      <InsightsReveal>
        {/* Header strip — period selector + closed-period note */}
        <div className="dash-head">
          <div className="head-left">
            <div className="head-prop">
              <span className="eyebrow">{to("header.eyebrow")}</span>
              <span className="name">{to("header.title")}</span>
            </div>
          </div>
          <div className="head-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {PeriodChips}
          </div>
        </div>
        <div
          style={{
            gridColumn: "span 12",
            fontSize: 11,
            color: "var(--t3)",
            margin: "0 0 8px",
            letterSpacing: "0.02em",
          }}
        >
          {to("header.freshness", { date: throughLabel })}
        </div>

        {/* ═══ SALES ═══ */}
        <div className="sec-label">
          <span className="txt">{to("sections.sales")}</span>
          <span className="rule" />
          <span className="meta">{to("sections.salesMeta")}</span>
        </div>

        {/* One row, 4 elements: Total sales (area) · Orders · AOV · Avg items / order */}
        <div className="tile" data-col style={{ gridColumn: "span 6" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">{to("kpi.totalSales")}</span>
              <div className="chart-figure">
                <span className="v">{fmtMoney(sales.value)}</span>
                <DeltaPill pct={sales.deltaPct} />
              </div>
            </div>
          </div>
          {sales.series.length > 1 ? (
            <AreaChartSvg values={sales.series} color={deltaColor(sales.deltaPct)} />
          ) : (
            <div className="tile-empty">{to("noData")}</div>
          )}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 2" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.orders")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtInt(orders.value)}</span>
            <DeltaPill pct={orders.deltaPct} />
          </div>
          {orders.series.length > 1 ? <Sparkline values={orders.series} color={deltaColor(orders.deltaPct)} /> : null}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 2" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.aov")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtMoney(aov.value)}</span>
            <DeltaPill pct={aov.deltaPct} />
          </div>
          {aov.series.length > 1 ? <Sparkline values={aov.series} color={deltaColor(aov.deltaPct)} /> : null}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 2" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.avgItems")}</span></div>
          <div className="chart-figure">
            <span className="v">{items.value.toFixed(1)}</span>
            <DeltaPill pct={items.deltaPct} />
          </div>
          {items.series.length > 1 ? <Sparkline values={items.series} color={deltaColor(items.deltaPct)} /> : null}
        </div>

        {/* ═══ TRAFFIC — sessions · users · who (our spine) ═══ */}
        <div className="sec-label">
          <span className="txt">{to("sections.traffic")}</span>
          <span className="rule" />
          <span className="meta">{to("sections.trafficMeta")}</span>
        </div>

        {/* Sessions timeline */}
        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">{to("kpi.sessions")}</span>
              <div className="chart-figure">
                <span className="v">{fmtInt(fSessions)}</span>
                <DeltaPill pct={sessionsDeltaPct} />
              </div>
            </div>
          </div>
          {funnelSeries.sessions.length > 1 ? (
            <AreaChartSvg values={funnelSeries.sessions} color={deltaColor(sessionsDeltaPct)} />
          ) : (
            <div className="tile-empty">{to("noData")}</div>
          )}
        </div>

        {/* Users timeline */}
        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="chart-head">
            <div>
              <span className="tile-label">{to("kpi.totalUsers")}</span>
              <div className="chart-figure">
                <span className="v">{fmtInt(users.total)}</span>
                <DeltaPill pct={users.deltaPct} />
              </div>
            </div>
          </div>
          {users.series.length > 1 ? (
            <AreaChartSvg values={users.series} color={deltaColor(users.deltaPct)} />
          ) : (
            <div className="tile-empty">{to("noData")}</div>
          )}
        </div>

        {/* Who — New / Returning / Anonymous (3-way partition of total users) */}
        <div className="tile" data-col style={{ gridColumn: "span 4" }}>
          <div className="tile-head">
            <span className="tile-label">{to("kpi.totalUsers")}</span>
            <span className="tile-sub">{to("kpi.whoBreakdown")}</span>
          </div>
          <div className="ringwrap">
            <div className="ring">
              <DonutMulti
                segments={[
                  { value: users.newReg, color: "var(--g-light)" },
                  { value: users.returningReg, color: "var(--g-dark)" },
                  { value: users.anonymous, color: "var(--blue)" },
                ]}
              />
              <div className="c">
                <span className="v">{fmtInt(users.total)}</span>
                <span className={`cd ${users.deltaPct >= 0 ? "up" : "down"}`}>
                  {fmtDelta(users.deltaPct)}
                </span>
              </div>
            </div>
            <div className="dleg">
              <div className="r">
                <span className="dot" style={{ background: "var(--g-light)" }} />
                <span className="nm">{to("kpi.newUsers")}</span>
                <span className="vv">{fmtInt(users.newReg)}</span>
              </div>
              <div className="r">
                <span className="dot" style={{ background: "var(--g-dark)" }} />
                <span className="nm">{to("kpi.returningUsers")}</span>
                <span className="vv">{fmtInt(users.returningReg)}</span>
              </div>
              <div className="r">
                <span className="dot" style={{ background: "var(--blue)" }} />
                <span className="nm">{to("kpi.anonymous")}</span>
                <span className="vv">{fmtInt(users.anonymous)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ FUNNEL — capture (our spine): sessions → searches → clicks → cart ═══ */}
        <div className="sec-label">
          <span className="txt">{to("sections.funnel")}</span>
          <span className="rule" />
          <span className="meta">{to("sections.funnelMeta")}</span>
        </div>
        <div className="tile" data-col style={{ gridColumn: "span 12" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 4, flexWrap: "wrap" }}>
            {/* Sessions — white count + delta + history */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="tile-label">{to("kpi.sessions")}</span>
              <div className="fn-fig">
                <span className="fn-v">{fmtInt(fSessions)}</span>
                <DeltaPill pct={sessionsDeltaPct} />
              </div>
              <span className="tile-sub" style={{ textAlign: "left" }}>{to("funnel.entered")}</span>
              {funnelSeries.sessions.length > 1 ? <Sparkline values={funnelSeries.sessions} color={deltaColor(sessionsDeltaPct)} /> : null}
            </div>
            <div style={{ flex: "none", color: "var(--t3)", paddingTop: 18 }}><Icon icon={ChevronRight} size={18} /></div>
            {/* Searches — white count + delta + history */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="tile-label">{to("kpi.searches")}</span>
              <div className="fn-fig">
                <span className="fn-v">{fmtInt(fSearches)}</span>
                <DeltaPill pct={searchesDeltaPct} />
              </div>
              <span className="tile-sub" style={{ textAlign: "left" }}>{to("funnel.performed")}</span>
              {funnelSeries.searches.length > 1 ? <Sparkline values={funnelSeries.searches} color={deltaColor(searchesDeltaPct)} /> : null}
            </div>
            <div style={{ flex: "none", color: "var(--t3)", paddingTop: 18 }}><Icon icon={ChevronRight} size={18} /></div>
            {/* Clicks — % of searches (white) + delta + rate history */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="tile-label">{to("funnel.clicks")}</span>
              <div className="fn-fig">
                <span className="fn-v">{fmtPct(clickRate)}</span>
                <DeltaPill pct={clickRateDeltaPp} label={fmtPp(clickRateDeltaPp)} />
              </div>
              <span className="tile-sub" style={{ textAlign: "left" }}>{to("funnel.ofSearches")}</span>
              {funnelSeries.clickRate.length > 1 ? <Sparkline values={funnelSeries.clickRate} color={deltaColor(clickRateDeltaPp)} /> : null}
            </div>
            <div style={{ flex: "none", color: "var(--t3)", paddingTop: 18 }}><Icon icon={ChevronRight} size={18} /></div>
            {/* Cart — search-to-cart reach % (white) + delta + rate history */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="tile-label">{to("funnel.cart")}</span>
              <div className="fn-fig">
                <span className="fn-v">{fmtPct(cartReach)}</span>
                <DeltaPill pct={cartReachDeltaPp} label={fmtPp(cartReachDeltaPp)} />
              </div>
              <span className="tile-sub" style={{ textAlign: "left" }}>{to("funnel.ofSearches")}</span>
              {funnelSeries.cartRate.length > 1 ? <Sparkline values={funnelSeries.cartRate} color={deltaColor(cartReachDeltaPp)} /> : null}
            </div>
          </div>
        </div>

        {/* ═══ SEARCH ═══ */}
        <div className="sec-label">
          <span className="txt">{to("sections.search")}</span>
          <span className="rule" />
          <span className="meta">{to("sections.searchMeta")}</span>
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.searches")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtInt(searchVol.value)}</span>
            <DeltaPill pct={searchVol.deltaPct} />
          </div>
          {searchVol.series.length > 1 ? <Sparkline values={searchVol.series} color={deltaColor(searchVol.deltaPct)} /> : null}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.noResultRate")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtPct(noResult.value)}</span>
            <DeltaPill pct={-noResult.deltaPp} label={fmtPp(noResult.deltaPp)} />
          </div>
          {noResult.series.length > 1 ? <Sparkline values={noResult.series} color={deltaColor(-noResult.deltaPp)} /> : null}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.searchCtr")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtPct(ctr.value)}</span>
            <DeltaPill pct={ctr.deltaPp} label={fmtPp(ctr.deltaPp)} />
          </div>
          {ctr.series.length > 1 ? <Sparkline values={ctr.series} color={deltaColor(ctr.deltaPp)} /> : null}
        </div>

        <div className="tile" data-col style={{ gridColumn: "span 3" }}>
          <div className="tile-head"><span className="tile-label">{to("kpi.searchToPurchase")}</span></div>
          <div className="chart-figure">
            <span className="v">{fmtPct(searchToPurchase.value)}</span>
            <DeltaPill pct={searchToPurchase.deltaPp} label={fmtPp(searchToPurchase.deltaPp)} />
          </div>
          {searchToPurchase.series.length > 1 ? <Sparkline values={searchToPurchase.series} color={deltaColor(searchToPurchase.deltaPp)} /> : null}
        </div>
      </InsightsReveal>
    </div>
  );
}
