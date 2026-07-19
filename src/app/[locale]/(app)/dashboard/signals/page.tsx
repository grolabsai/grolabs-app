import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { Route } from "next";
import { currentInstanceId } from "@/lib/instance";
import {
  getSignalsData,
  rolling7,
  MIN_CLOSED_WEEKS,
  MIN_WEEKLY_DEN,
  SIGNAL_METRICS,
  SIGNAL_METRIC_BY_KEY,
  type MetricSignal,
  type SignalsData,
} from "@/lib/analytics/signals";
import { DashboardTabs } from "../_dashboard-tabs";
import { InsightsReveal } from "@/components/dashboard/insights/_reveal";
import { fmtInt, fmtPct, fmtMoney, fmtSignedPct, fmtSignedPp } from "@/components/dashboard/insights/charts";
import { SignalSpark, weekLabel } from "@/components/dashboard/insights/signal-charts";
import {
  ControlChart,
  type PointTier,
  WowBars,
  CusumChart,
  DailyRollingChart,
  WeeklyColumns,
  WeekdayStrip,
  FunnelPlot,
} from "@/components/dashboard/insights/signal-charts-client";
import type { ChartTip, DeltaChip, DeltaLayerData } from "@/components/dashboard/insights/signal-chart-util";
import type { GoodDirection } from "@/lib/analytics/signals";
import "@/components/dashboard/insights/insights.css";
import "@/components/dashboard/insights/signals.css";

const DEFAULT_METRIC = "session_conversion";

type Translate = (key: string, values?: Record<string, string | number>) => string;

function fmtFor(sig: MetricSignal): (v: number) => string {
  if (sig.def.kind === "money") return (v) => fmtMoney(v);
  if (sig.def.kind === "rate") return (v) => fmtPct(v);
  return (v) => fmtInt(v);
}

/** Headline value for a tile — counts instead of % when the week is too thin. */
function tileValue(sig: MetricSignal): string {
  if (sig.latest === null) return "—";
  if (sig.def.kind === "rate" && sig.lowVolume) {
    return `${fmtInt(sig.latest.num)} / ${fmtInt(sig.latest.den)}`;
  }
  return fmtFor(sig)(sig.latest.value);
}

/** Plain-language sentence for a tile, from the machine reasons. */
function tileSentence(t: Translate, sig: MetricSignal): string {
  const drift = fmtSignedPct(sig.driftPct);
  if (sig.state === "insufficient") {
    return t("sentence.insufficient", { weeks: sig.weeks.length, min: MIN_CLOSED_WEEKS });
  }
  const parts: string[] = [];
  if (sig.state === "stable") {
    parts.push(t("sentence.stable", { weeks: sig.weeks.length }));
  } else {
    const reason = sig.reasons[0];
    parts.push(t(`sentence.${reason}`, { weeks: Math.abs(sig.run), drift }));
  }
  if (sig.lowVolume) parts.push(t("sentence.lowVolume", { min: MIN_WEEKLY_DEN }));
  return parts.join(" ");
}

function stateChip(t: Translate, state: MetricSignal["state"]) {
  const glyph =
    state === "improving" ? "▲" : state === "declining" ? "▼" : state === "stable" ? "→" : "◌";
  return (
    <span className={`sig-state ${state}`}>
      {glyph} {t(`state.${state}`)}
    </span>
  );
}

function endColor(state: MetricSignal["state"]): string {
  return state === "improving"
    ? "var(--success)"
    : state === "declining"
      ? "var(--danger-solid)"
      : "rgba(237,234,224,0.55)";
}

/** Verdict = the owner's one-line answer, from the per-metric states. */
function verdict(t: Translate, data: SignalsData) {
  const sigs = SIGNAL_METRICS.map((d) => data.metrics[d.key]).filter(Boolean);
  const label = (s: MetricSignal) => t(`metric.${s.def.key}`);
  const declining = sigs.filter((s) => s.state === "declining");
  const improving = sigs.filter((s) => s.state === "improving");
  const insufficient = sigs.filter((s) => s.state === "insufficient");

  const state =
    declining.length > 0
      ? "declining"
      : insufficient.length === sigs.length
        ? "insufficient"
        : improving.length > 0
          ? "improving"
          : "stable";

  const headline =
    state === "declining"
      ? t("verdict.declining", { metrics: declining.map(label).join(", ") })
      : state === "improving"
        ? t("verdict.improving", { metrics: improving.map(label).join(", ") })
        : state === "insufficient"
          ? t("verdict.insufficient")
          : t("verdict.steady");

  const parts: string[] = [];
  for (const s of declining) {
    parts.push(t("verdict.partDeclining", { metric: label(s), sentence: tileSentence(t, s) }));
  }
  for (const s of improving) {
    parts.push(t("verdict.partImproving", { metric: label(s), sentence: tileSentence(t, s) }));
  }
  if (state === "insufficient") {
    parts.push(t("sentence.insufficient", { weeks: data.closedWeeks, min: MIN_CLOSED_WEEKS }));
  } else if (declining.length + improving.length < sigs.length) {
    parts.push(t("verdict.partStable"));
  }
  return { state, headline, body: parts.join(" ") };
}

/** "Fri · Jul 17" from YYYY-MM-DD (data-derived, not i18n copy). */
function dayTitle(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} · ${weekLabel(day)}`;
}

export default async function SignalsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string }>;
}) {
  const t = await getTranslations("dashboard");
  const ts = await getTranslations("dashboard.signals");
  const { metric: metricParam } = await searchParams;
  const focusKey =
    metricParam && SIGNAL_METRIC_BY_KEY[metricParam] ? metricParam : DEFAULT_METRIC;

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const data = await getSignalsData(instanceId);
  const focus = data.metrics[focusKey];
  const orders = data.metrics["orders"];
  const conv = data.metrics["session_conversion"];
  const v = verdict(ts, data);

  // Freshness: through the Sunday closing the last complete week.
  const lastSunday = (() => {
    const [y, m, d] = data.lastClosedWeekStart.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    dt.setUTCDate(dt.getUTCDate() + 6);
    return dt.toISOString().slice(0, 10);
  })();
  const throughLabel = new Date(`${lastSunday}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });

  // Focus-metric derived pieces.
  const focusLabels = focus.weeks.map((w) => weekLabel(w.weekStart));
  const focusFmt = fmtFor(focus);
  const focusIsRate = focus.def.kind === "rate";
  const badIsLow = focus.def.good === "up";
  // Per-week color tier (the ratified color code, direction-aware): outside
  // the band on the bad side = red; outside on the good side = green; inside
  // the band but on the weak side of centre = yellow; otherwise neutral blue.
  const tiers: PointTier[] =
    focus.baseline === null
      ? []
      : focus.values.map((val) => {
          const b = focus.baseline!;
          const belowBand = val < b.lcl, aboveBand = val > b.ucl;
          if (badIsLow ? belowBand : aboveBand) return "bad";
          if (badIsLow ? aboveBand : belowBand) return "good";
          if (badIsLow ? val < b.cl : val > b.cl) return "warn";
          return "neutral";
        });
  // Ratified time grammar: only the violating stretch that reaches the latest
  // week stays bright red; earlier violations become pink reference (scars).
  {
    let i = tiers.length - 1;
    while (i >= 0 && tiers[i] === "bad") i--;
    for (let j = 0; j <= i; j++) if (tiers[j] === "bad") tiers[j] = "badPast";
  }
  const badCusum = badIsLow ? focus.cusumDown : focus.cusumUp;
  const badCross = badIsLow ? focus.cusumDownCross : focus.cusumUpCross;
  const wowThreshold = badIsLow ? -5 : 5;
  const cusumFmt = (c: number) =>
    focusIsRate ? `${(c * 100).toFixed(2)} pts`
    : focus.def.kind === "money" ? fmtMoney(c)
    : fmtInt(c);
  const vsCentre = (val: number, cl: number) =>
    focusIsRate ? fmtSignedPp((val - cl) * 100) : fmtSignedPct(cl !== 0 ? ((val - cl) / Math.abs(cl)) * 100 : 0);

  // Tooltip content (built here so i18n stays server-side).
  const focusTips: ChartTip[] =
    focus.baseline === null
      ? []
      : focus.values.map((val, i) => ({
          title: ts("charts.tt.weekOf", { date: focusLabels[i] }),
          rows: [
            { k: ts(`metric.${focusKey}`), v: focusFmt(val) },
            { k: ts("charts.tt.vsCentre"), v: vsCentre(val, focus.baseline!.cl) },
            {
              k: ts("charts.tt.reading"),
              v: ts(`charts.tt.tier_${tiers[i] ?? "neutral"}`),
            },
          ],
        }));
  const wowTips: (ChartTip | null)[] = focus.wow.map((w, i) =>
    w == null
      ? null
      : {
          title: ts("charts.tt.weekOf", { date: focusLabels[i] }),
          rows: [
            { k: ts("charts.tt.wowChange"), v: fmtSignedPct(w) },
            {
              k: ts("charts.tt.alarm", { pct: `${wowThreshold > 0 ? "+" : ""}${wowThreshold}%` }),
              v: (badIsLow ? w <= wowThreshold : w >= wowThreshold)
                ? ts("charts.tt.alarmYes")
                : ts("charts.tt.alarmNo"),
            },
          ],
        },
  );
  const cusumTips: ChartTip[] = badCusum.map((c, i) => ({
    title: ts("charts.tt.weekOf", { date: focusLabels[i] }),
    rows: [
      { k: ts("charts.tt.accumulated"), v: cusumFmt(c) },
      { k: ts("charts.tt.decisionLimit"), v: cusumFmt(focus.h) },
      {
        k: ts("charts.tt.status"),
        v: c > focus.h ? ts("charts.tt.statusAlarm") : ts("charts.tt.statusAccumulating"),
      },
    ],
  }));

  // Rhythm: daily sessions + rolling mean + same-weekday strip.
  const dailyVals = data.dailySessions.map((d) => d.value);
  const roll = rolling7(dailyVals);
  const lastRoll = [...roll].reverse().find((x): x is number => x != null) ?? null;
  const dailyTips: ChartTip[] = data.dailySessions.map((d, i) => ({
    title: dayTitle(d.day),
    rows: [
      { k: ts("charts.tt.sessionsRow"), v: fmtInt(d.value) },
      { k: ts("charts.tt.rollingRow"), v: roll[i] == null ? "—" : fmtInt(roll[i] as number) },
    ],
  }));
  const weekdayPts: { day: string; value: number }[] = [];
  for (let i = dailyVals.length - 1 - 7; i >= 0; i -= 7) {
    weekdayPts.unshift({ day: data.dailySessions[i].day, value: dailyVals[i] });
  }
  const weekdayName =
    data.dailySessions.length > 0
      ? new Date(`${data.dailySessions[data.dailySessions.length - 1].day}T12:00:00Z`)
          .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      : "";
  const weekdayTips: ChartTip[] = weekdayPts.map((p) => ({
    title: dayTitle(p.day),
    rows: [{ k: ts("charts.tt.sessionsRow"), v: fmtInt(p.value) }],
  }));
  const weekdayCurrentTip: ChartTip | null =
    data.dailySessions.length > 0
      ? {
          title: dayTitle(data.dailySessions[data.dailySessions.length - 1].day),
          rows: [
            { k: ts("charts.tt.sessionsRow"), v: fmtInt(dailyVals[dailyVals.length - 1]) },
          ],
        }
      : null;

  // Weekly columns.
  const weekTips: ChartTip[] = orders.weeks.map((w) => ({
    title: ts("charts.tt.weekOfClosed", { date: weekLabel(w.weekStart) }),
    rows: [{ k: ts("charts.tt.ordersRow"), v: fmtInt(w.value) }],
  }));
  const partialTip: ChartTip | null = orders.partial
    ? {
        title: ts("charts.tt.weekOf", { date: weekLabel(orders.partial.weekStart) }),
        rows: [
          { k: ts("charts.tt.ordersRow"), v: fmtInt(orders.partial.value) },
          { k: ts("charts.tt.status"), v: ts("charts.tt.inProgressStatus") },
        ],
      }
    : null;

  // Funnel plot: weekly conversion vs weekly sessions.
  const funnelPoints = conv.weeks
    .filter((w) => w.den > 0)
    .map((w) => ({ n: w.den, p: w.den > 0 ? w.num / w.den : 0, weekStart: w.weekStart }));
  const pooledNum = conv.weeks.reduce((s, w) => s + w.num, 0);
  const pooledDen = conv.weeks.reduce((s, w) => s + w.den, 0);
  const p0 = pooledDen > 0 ? pooledNum / pooledDen : 0;
  const funnelTips: ChartTip[] = funnelPoints.map((q) => {
    const se = Math.sqrt((p0 * (1 - p0)) / Math.max(q.n, 1));
    const out3 = Math.abs(q.p - p0) > 3 * se;
    return {
      title: `${ts("charts.tt.weekOf", { date: weekLabel(q.weekStart) })} · ${fmtInt(q.n)} ${ts("charts.tt.sessionsUnit")}`,
      rows: [
        { k: ts("metric.session_conversion"), v: fmtPct(q.p) },
        { k: ts("charts.tt.naiveDelta"), v: p0 > 0 ? fmtSignedPct(((q.p - p0) / p0) * 100) : "—" },
        {
          k: ts("charts.tt.honestReading"),
          v: out3 ? ts("charts.tt.funnelSignal") : ts("charts.tt.funnelNoise"),
        },
      ],
    };
  });

  // Hover-revealed anchored deltas: vs window start / window average / last
  // week — chips colored by their own direction relative to the metric's good
  // direction (research: labels make adaptive baselines trustworthy).
  const deltaLayer = (vals: number[], good: GoodDirection): DeltaLayerData | null => {
    if (vals.length < 3) return null;
    const last = vals[vals.length - 1];
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const chip = (baseline: number, label: string): DeltaChip => {
      const pct = baseline !== 0 ? (last / baseline - 1) * 100 : 0;
      const dir: DeltaChip["dir"] =
        Math.abs(pct) <= 1 ? "flat" : (pct > 0) === (good === "up") ? "good" : "bad";
      return { label: `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% ${label}`, dir };
    };
    return {
      avg,
      chips: {
        start: chip(vals[0], ts("charts.delta.vsStart")),
        avg: chip(avg, ts("charts.delta.vsAvg")),
        last: chip(vals[vals.length - 2], ts("charts.delta.vsLastWk")),
      },
    };
  };
  const focusDeltas = deltaLayer(focus.values, focus.def.good);
  const orderDeltas = deltaLayer(orders.values, "up");
  const rollValues = roll.filter((v): v is number => v != null);
  const rollDeltas = deltaLayer(rollValues, "up");

  const MetricChips = (
    <div className="ov-chips">
      {SIGNAL_METRICS.filter((d) => d.take === "rate" || d.key === "orders" || d.key === "sessions").map((d) => (
        <Link
          key={d.key}
          href={`/dashboard/signals?metric=${d.key}` as Route}
          className={`ov-chip${d.key === focusKey ? " active" : ""}`}
        >
          {ts(`metric.${d.key}`)}
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
        <div className="dash-head">
          <div className="head-left">
            <div className="head-prop">
              <span className="eyebrow">{ts("header.eyebrow")}</span>
              <span className="name">{ts("header.title")}</span>
            </div>
          </div>
        </div>
        <div
          style={{
            gridColumn: "span 12", fontSize: 11, color: "var(--t3)",
            margin: "0 0 8px", letterSpacing: "0.02em",
          }}
        >
          {ts("header.freshness", { date: throughLabel })} · {data.tzLabel}
        </div>

        {data.closedWeeks === 0 ? (
          <div className="tile" data-col style={{ gridColumn: "span 12" }}>
            <div className="tile-empty">{ts("noData")}</div>
          </div>
        ) : (
          <>
            {/* ═══ VERDICT ═══ */}
            <div className="sec-label">
              <span className="txt">{ts("sections.verdict")}</span>
              <span className="rule" />
              <span className="meta">{ts("sections.verdictMeta")}</span>
            </div>

            <div className="sig-verdict" data-col data-state={v.state}>
              <p className="headline">{v.headline}</p>
              <p className="body">{v.body}</p>
            </div>

            {SIGNAL_METRICS.map((d) => {
              const sig = data.metrics[d.key];
              return (
                <div key={d.key} className="tile" data-col style={{ gridColumn: "span 4" }}>
                  <div className="tile-head">
                    <span className="tile-label">{ts(`metric.${d.key}`)}</span>
                    {stateChip(ts, sig.state)}
                  </div>
                  <div className="chart-figure">
                    <span className="v">{tileValue(sig)}</span>
                  </div>
                  <div className="sig-sentence">{tileSentence(ts, sig)}</div>
                  <SignalSpark
                    values={sig.values}
                    cl={sig.baseline?.cl ?? null}
                    ucl={sig.baseline?.ucl ?? null}
                    lcl={sig.baseline?.lcl ?? null}
                    endColor={endColor(sig.state)}
                  />
                </div>
              );
            })}

            {/* ═══ DEEP DIVE — process behaviour + drift, one metric at a time ═══ */}
            <div className="sec-label">
              <span className="txt">{ts("sections.deepdive")}</span>
              <span className="rule" />
              <span className="meta">{ts("sections.deepdiveMeta")}</span>
            </div>

            <div className="tile" data-col style={{ gridColumn: "span 12" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <span className="tile-label">
                  {ts("charts.controlTitle", { metric: ts(`metric.${focusKey}`) })}
                </span>
                {MetricChips}
              </div>
              {focus.baseline !== null ? (
                <>
                  <div className="sig-legend">
                    <span className="k"><span className="ln" />{ts("charts.legendWeekly")}</span>
                    <span className="k"><span className="sw" />{ts("charts.legendBand")}</span>
                    <span className="k"><span className="ln ctr" />{ts("charts.legendCentre")}</span>
                    <span className="k"><span className="pt warn" />{ts("charts.legendWarn")}</span>
                    <span className="k"><span className="pt bad" />{ts("charts.legendSignal")}</span>
                    <span className="k"><span className="pt pink" />{ts("charts.legendPastSignal")}</span>
                    <span className="k"><span className="pt good" />{ts("charts.legendGoodBreak")}</span>
                  </div>
                  <ControlChart
                    labels={focusLabels}
                    values={focus.values}
                    cl={focus.baseline.cl}
                    ucl={focus.baseline.ucl}
                    lcl={focus.baseline.lcl}
                    tiers={tiers}
                    upperLabel={`${ts("charts.upper")} ${focusFmt(focus.baseline.ucl)}`}
                    centreLabel={`${ts("charts.centre")} ${focusFmt(focus.baseline.cl)}`}
                    lowerLabel={`${ts("charts.lower")} ${focusFmt(focus.baseline.lcl)}`}
                    signalText={ts("charts.signalOut")}
                    tips={focusTips}
                    deltas={focusDeltas}
                  />
                  <div className="sig-note">{ts("charts.controlNote")}</div>
                </>
              ) : (
                <div className="tile-empty">
                  {ts("insufficientChart", { min: MIN_CLOSED_WEEKS })}
                </div>
              )}
            </div>

            {focus.baseline !== null ? (
              <>
                <div className="tile" data-col style={{ gridColumn: "span 6" }}>
                  <div className="tile-head">
                    <span className="tile-label">{ts("charts.wowTitle")}</span>
                  </div>
                  <WowBars
                    labels={focusLabels}
                    wow={focus.wow}
                    thresholdPct={wowThreshold}
                    thresholdText={`${wowThreshold > 0 ? "+" : ""}${wowThreshold}%`}
                    tips={wowTips}
                  />
                  <div className="sig-note">{ts("charts.wowNote")}</div>
                </div>

                <div className="tile" data-col style={{ gridColumn: "span 6" }}>
                  <div className="tile-head">
                    <span className="tile-label">{ts("charts.cusumTitle")}</span>
                  </div>
                  <CusumChart
                    labels={focusLabels}
                    cusum={badCusum}
                    h={focus.h}
                    crossIdx={badCross}
                    limitText={ts("charts.cusumLimit")}
                    alarmText={ts("charts.cusumAlarm")}
                    tips={cusumTips}
                  />
                  <div className="sig-note">{ts("charts.cusumNote")}</div>
                </div>
              </>
            ) : null}

            {/* ═══ RHYTHM — daily noise vs the rolling week ═══ */}
            {data.dailySessions.length >= 14 ? (
              <>
                <div className="sec-label">
                  <span className="txt">{ts("sections.rhythm")}</span>
                  <span className="rule" />
                  <span className="meta">{ts("sections.rhythmMeta")}</span>
                </div>

                <div className="tile" data-col style={{ gridColumn: "span 8" }}>
                  <div className="tile-head">
                    <span className="tile-label">{ts("charts.rhythmTitle")}</span>
                  </div>
                  <div className="sig-legend">
                    <span className="k"><span className="ln mut" />{ts("charts.legendDaily")}</span>
                    <span className="k"><span className="ln" />{ts("charts.legendRolling")}</span>
                  </div>
                  <DailyRollingChart
                    days={data.dailySessions.map((d) => d.day)}
                    daily={dailyVals}
                    rolling={roll}
                    endLabel={lastRoll != null ? ts("charts.perDay", { n: fmtInt(lastRoll) }) : ""}
                    tips={dailyTips}
                    deltas={rollDeltas}
                  />
                  <div className="sig-note">{ts("charts.rhythmNote")}</div>
                </div>

                <div className="tile" data-col style={{ gridColumn: "span 4" }}>
                  <div className="tile-head">
                    <span className="tile-label">
                      {ts("charts.weekdayTitle", { weekday: weekdayName })}
                    </span>
                  </div>
                  {weekdayPts.length >= 2 && weekdayCurrentTip ? (
                    <WeekdayStrip
                      values={weekdayPts.map((p) => p.value)}
                      current={dailyVals[dailyVals.length - 1]}
                      currentText={ts("charts.thisDay", { weekday: weekdayName })}
                      tips={weekdayTips}
                      currentTip={weekdayCurrentTip}
                    />
                  ) : (
                    <div className="tile-empty">{ts("noData")}</div>
                  )}
                  <div className="sig-note">{ts("charts.weekdayNote")}</div>
                </div>
              </>
            ) : null}

            {/* ═══ COMPLETE WEEKS + SMALL-SAMPLE LENS ═══ */}
            <div className="sec-label">
              <span className="txt">{ts("sections.weeks")}</span>
              <span className="rule" />
              <span className="meta">{ts("sections.weeksMeta")}</span>
            </div>

            <div className="tile" data-col style={{ gridColumn: "span 5" }}>
              <div className="tile-head">
                <span className="tile-label">{ts("charts.weeksTitle")}</span>
              </div>
              <div className="sig-legend">
                <span className="k"><span className="sw" style={{ background: "var(--blue)", opacity: 0.85 }} />{ts("charts.legendClosed")}</span>
                <span className="k"><span className="sw partial" />{ts("charts.legendPartial")}</span>
              </div>
              <WeeklyColumns
                labels={orders.weeks.map((w) => weekLabel(w.weekStart))}
                values={orders.values}
                partialValue={orders.partial?.value ?? null}
                partialLabel={orders.partial ? weekLabel(orders.partial.weekStart) : ""}
                partialTag={ts("charts.inProgress")}
                tips={weekTips}
                partialTip={partialTip}
                deltas={orderDeltas}
              />
              <div className="sig-note">{ts("charts.weeksNote")}</div>
            </div>

            <div className="tile" data-col style={{ gridColumn: "span 7" }}>
              <div className="tile-head">
                <span className="tile-label">{ts("charts.funnelTitle")}</span>
              </div>
              {funnelPoints.length >= 3 && p0 > 0 ? (
                <>
                  <div className="sig-legend">
                    <span className="k"><span className="pt mut" />{ts("charts.legendWeeks")}</span>
                    <span className="k"><span className="pt good" />{ts("charts.legendLatest")}</span>
                    <span className="k"><span className="pt bad" />{ts("charts.legendOutside")}</span>
                    <span className="k"><span className="pt pink" />{ts("charts.legendPastSignal")}</span>
                  </div>
                  <FunnelPlot
                    points={funnelPoints.map((q) => ({ n: q.n, p: q.p }))}
                    p0={p0}
                    latestIdx={funnelPoints.length - 1}
                    overallText={ts("charts.funnelOverall")}
                    axisText={ts("charts.funnelAxis")}
                    signalText={ts("charts.funnelSignal")}
                    tips={funnelTips}
                  />
                  <div className="sig-note">{ts("charts.funnelNote")}</div>
                </>
              ) : (
                <div className="tile-empty">{ts("noData")}</div>
              )}
            </div>
          </>
        )}
      </InsightsReveal>
    </div>
  );
}
