"use client";

/**
 * Interactive Signals charts — the same server-computed data and drawing
 * vocabulary as before, but hydrated so every mark answers the pointer with a
 * precise readout (and keyboard focus shows the same tooltip as hover).
 *
 * i18n stays on the server: the page prebuilds every tooltip's title/rows
 * (ChartTip) and passes them down; this layer only positions and displays.
 */

import { useId, useRef, useState, type PointerEvent } from "react";
import {
  AX, GRID, CENTRE, BAND, LINE, BAD, GOOD, MUTED, PINK, PINKLINE, F,
  lin, pad, smoothPath, tickIdx, Grad, weekLabel,
  type ChartTip, type DeltaChip, type DeltaLayerData,
} from "./signal-chart-util";
import { useChartTip, Hit } from "./chart-tip";

const useGradId = () => {
  const raw = useId();
  return "sg" + raw.replace(/[^a-zA-Z0-9]/g, "");
};

// ── Process-behaviour (XmR) chart ───────────────────────────────────────────

export type PointTier = "good" | "neutral" | "warn" | "bad" | "badPast";

const TIER_COLOR: Record<PointTier, string> = {
  good: GOOD,
  neutral: LINE,
  warn: "var(--amber)",
  bad: BAD,        // the violation that reaches today — the wound
  badPast: PINK,   // a violation that ended — the scar
};

// ── Hover-revealed anchored deltas (ratified: hidden by default) ────────────

const CHIP_STYLE: Record<DeltaChip["dir"], { bg: string; br: string; tx: string }> = {
  good: { bg: "rgba(52,211,153,0.13)", br: "rgba(52,211,153,0.45)", tx: "#34d399" },
  bad: { bg: "rgba(239,68,68,0.13)", br: "rgba(239,68,68,0.45)", tx: "#fca5a5" },
  flat: { bg: "rgba(127,176,201,0.13)", br: "rgba(127,176,201,0.45)", tx: "#7fb0c9" },
};

function useHoverReveal() {
  const [show, setShow] = useState(false);
  return {
    show,
    handlers: {
      onPointerEnter: () => setShow(true),
      onPointerLeave: () => setShow(false),
    },
  };
}

function ChipRect({ x, y, chip, anchor }: {
  x: number; y: number; chip: DeltaChip;
  anchor?: { x: number; y: number };
}) {
  const st = CHIP_STYLE[chip.dir];
  const w = chip.label.length * 5.4 + 12, h = 16;
  return (
    <g>
      {anchor ? (
        <>
          <line x1={x + w / 2} y1={y + h} x2={anchor.x} y2={anchor.y}
            stroke="rgba(237,234,224,0.22)" strokeWidth={1} />
          <circle cx={anchor.x} cy={anchor.y} r={5.5} fill="none"
            stroke="rgba(237,234,224,0.4)" strokeWidth={1} />
        </>
      ) : null}
      <rect x={x} y={y} width={w} height={h} rx={5} fill={st.bg} stroke={st.br} strokeWidth={1} />
      <text x={x + w / 2} y={y + 11.5} textAnchor="middle" fontSize={9.5}
        fontWeight={600} fill={st.tx}>{chip.label}</text>
    </g>
  );
}

/** The three anchored deltas + the average line, revealed on block hover.
 *  first/prev anchors are the points the start/last chips measure against;
 *  the avg chip sits on its own baseline. */
function DeltaLayer({ show, deltas, avgY, x0, x1, first, prev, chipY }: {
  show: boolean;
  deltas: DeltaLayerData;
  avgY: number;
  x0: number; x1: number;
  first: { x: number; y: number };
  prev: { x: number; y: number };
  chipY: number;
}) {
  const avgChipW = deltas.chips.avg.label.length * 5.4 + 12;
  const lastChipW = deltas.chips.last.label.length * 5.4 + 12;
  return (
    <g className={`sig-deltas${show ? " show" : ""}`} pointerEvents="none">
      <line x1={x0} x2={x1} y1={avgY} y2={avgY} stroke={CENTRE} strokeWidth={1} />
      <ChipRect x={Math.max(x0 - 24, 2)} y={chipY} chip={deltas.chips.start}
        anchor={{ x: first.x, y: first.y }} />
      <ChipRect x={x1 - lastChipW + 20} y={chipY} chip={deltas.chips.last}
        anchor={{ x: prev.x, y: prev.y }} />
      <ChipRect x={x0 + (x1 - x0) * 0.44 - avgChipW / 2} y={avgY - 8} chip={deltas.chips.avg} />
    </g>
  );
}

export function ControlChart({
  labels, values, cl, ucl, lcl, tiers,
  upperLabel, centreLabel, lowerLabel, signalText, tips, deltas,
}: {
  labels: string[];
  values: number[];
  cl: number; ucl: number; lcl: number;
  /** Color-code tier per week: outside-band bad = red (current stretch) or
   *  pink (past), weak side of centre within band = yellow, outside-band
   *  good = green, else neutral blue. */
  tiers: PointTier[];
  upperLabel: string; centreLabel: string; lowerLabel: string; signalText: string;
  tips: ChartTip[];
  /** Hover-revealed anchored deltas (hidden by default per the color grammar). */
  deltas?: DeltaLayerData | null;
}) {
  const api = useChartTip();
  const gid = useGradId();
  const reveal = useHoverReveal();
  const W = 720, H = 210, m = { l: 8, r: 118, t: 14, b: 24 };
  const lo = Math.min(...values, lcl), hi = Math.max(...values, ucl);
  const [d0, d1] = pad([lo, hi]);
  const x = lin(0, Math.max(values.length - 1, 1), m.l + 8, W - m.r - 8);
  const y = lin(d0, d1, H - m.b, m.t);
  const xs = values.map((_, i) => x(i));
  const ys = values.map((v) => y(v));
  const firstBad = tiers.findIndex((t) => t === "bad" || t === "badPast");
  const lx = W - m.r + 6;
  const line = smoothPath(xs, ys);
  const n = values.length;

  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%" {...reveal.handlers}>
      <rect x={m.l} y={y(ucl)} width={W - m.r - m.l} height={Math.max(y(lcl) - y(ucl), 0)} fill={BAND} rx={2} />
      <line x1={m.l} x2={W - m.r} y1={y(cl)} y2={y(cl)} stroke={CENTRE} strokeWidth={1.2} />
      <line x1={m.l} x2={W - m.r} y1={y(ucl)} y2={y(ucl)} stroke={GRID} strokeWidth={1} />
      <line x1={m.l} x2={W - m.r} y1={y(lcl)} y2={y(lcl)} stroke={GRID} strokeWidth={1} />
      <text x={lx} y={y(ucl) + 3} fontSize={F} fill={AX}>{upperLabel}</text>
      <text x={lx} y={y(cl) + 3} fontSize={F} fill="var(--t2)">{centreLabel}</text>
      <text x={lx} y={y(lcl) + 3} fontSize={F} fill={AX}>{lowerLabel}</text>

      <Grad id={gid} color={LINE} />
      <path
        d={`${line} L ${xs[xs.length - 1].toFixed(1)} ${H - m.b} L ${xs[0].toFixed(1)} ${H - m.b} Z`}
        fill={`url(#${gid})`}
      />
      <path d={line} fill="none" stroke={LINE} strokeWidth={2.2}
        strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => {
        const tier = tiers[i] ?? "neutral";
        return (
          <circle key={i} cx={xs[i]} cy={ys[i]} r={tier === "neutral" ? 3 : 4}
            fill={TIER_COLOR[tier]} stroke="var(--page-bg)" strokeWidth={1.5} />
        );
      })}
      {firstBad >= 0 ? (
        <text
          x={Math.min(xs[firstBad], W - m.r - 4)} y={ys[firstBad] + 16}
          fontSize={F} fill={BAD} textAnchor="end"
        >{signalText}</text>
      ) : null}
      {tickIdx(labels.length).map((i) => (
        <text key={i} x={xs[i]} y={H - 8} fontSize={F} fill={AX} textAnchor="middle">
          {labels[i]}
        </text>
      ))}
      {deltas && n >= 3 ? (
        <DeltaLayer show={reveal.show} deltas={deltas}
          avgY={y(deltas.avg)} x0={m.l} x1={W - m.r}
          first={{ x: xs[0], y: ys[0] }} prev={{ x: xs[n - 2], y: ys[n - 2] }}
          chipY={0} />
      ) : null}
      {values.map((_, i) => (
        <Hit key={`h${i}`} x={xs[i]} y={ys[i]} tip={tips[i]} api={api} />
      ))}
    </svg>,
  );
}

// ── Week-over-week delta bars ───────────────────────────────────────────────

export function WowBars({
  labels, wow, thresholdPct, thresholdText, tips,
}: {
  labels: string[];
  wow: (number | null)[];
  thresholdPct: number;
  thresholdText: string;
  tips: (ChartTip | null)[];
}) {
  const api = useChartTip();
  const W = 360, H = 190, m = { l: 34, r: 6, t: 12, b: 22 };
  const mag = Math.max(8, ...wow.map((v) => Math.abs(v ?? 0)), Math.abs(thresholdPct) + 2);
  const y = lin(-mag, mag, H - m.b, m.t);
  const x = lin(0, Math.max(wow.length - 1, 1), m.l + 10, W - m.r - 10);
  const bw = Math.min(10, ((W - m.l - m.r) / Math.max(wow.length, 1)) * 0.55);
  // Past breaches wear pink; only a breach on the LATEST bar is the wound (red).
  const breaches = (v: number | null) =>
    v != null && (thresholdPct < 0 ? v <= thresholdPct : v >= thresholdPct);
  const lastIdx = wow.length - 1;
  const anyBreach = wow.some((v) => breaches(v));
  const ty = y(thresholdPct);

  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {[-mag, 0, mag].map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">
            {`${g > 0 ? "+" : ""}${Math.round(g)}%`}
          </text>
        </g>
      ))}
      {/* Quiet reference: dotted pink line, number in the axis. Only a breach
          turns the label bold and adds the fired badge (the ratified grammar). */}
      <line x1={m.l} x2={W - m.r} y1={ty} y2={ty} stroke={PINKLINE} strokeWidth={1}
        strokeDasharray="2 4" strokeLinecap="round" />
      <text x={m.l - 4} y={ty + 3} fontSize={F} textAnchor="end"
        fontWeight={anyBreach ? 700 : 400}
        fill={anyBreach ? "#fca5a5" : "rgba(252,165,165,0.55)"}>
        {thresholdText}
      </text>
      {anyBreach ? (
        <g>
          <circle cx={m.l - 24} cy={ty} r={6} fill={BAD} />
          <text x={m.l - 24} y={ty + 3.2} textAnchor="middle" fontSize={8.5}
            fontWeight={700} fill="var(--page-bg)">!</text>
        </g>
      ) : null}
      {wow.map((v, i) => {
        if (v == null) return null;
        const y0 = y(0), y1 = y(v);
        const fill = breaches(v)
          ? (i === lastIdx ? BAD : PINK)
          : "rgba(127,176,201,0.75)";
        return (
          <rect key={i} x={x(i) - bw / 2} y={Math.min(y0, y1)}
            width={bw} height={Math.max(Math.abs(y1 - y0), 1)}
            fill={fill} rx={1.5} />
        );
      })}
      {tickIdx(labels.length, 3).map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{labels[i]}</text>
      ))}
      {wow.map((v, i) => {
        const tip = tips[i];
        if (v == null || !tip) return null;
        return (
          <rect
            key={`h${i}`} x={x(i) - bw} y={m.t} width={bw * 2} height={H - m.t - m.b}
            fill="transparent" tabIndex={0} style={{ outline: "none" }}
            onPointerEnter={(e) => api.show(e, tip)}
            onPointerMove={(e) => api.show(e, tip)}
            onPointerLeave={api.hide}
            onFocus={(e) => api.showFocus(e, tip)}
            onBlur={api.hide}
          />
        );
      })}
    </svg>,
  );
}

// ── CUSUM drift chart ───────────────────────────────────────────────────────

export function CusumChart({
  labels, cusum, h, crossIdx, limitText, alarmText, tips,
}: {
  labels: string[];
  cusum: number[];
  h: number;
  crossIdx: number;
  limitText: string;
  alarmText: string;
  tips: ChartTip[];
}) {
  const api = useChartTip();
  const gid = useGradId();
  const W = 360, H = 190, m = { l: 34, r: 6, t: 14, b: 22 };
  const hi = Math.max(...cusum, h) * 1.15 || 1;
  const y = lin(0, hi, H - m.b, m.t);
  const x = lin(0, Math.max(cusum.length - 1, 1), m.l + 10, W - m.r - 10);
  const xs = cusum.map((_, i) => x(i));
  const ys = cusum.map((v) => y(v));
  const line = smoothPath(xs, ys);

  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {[0, hi / 2, hi].map((g, gi) => (
        <line key={gi} x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)}
          stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
      ))}
      {/* Decision limit: quiet dotted-pink reference; the fired badge appears
          only while the accumulated drift is currently over the limit. */}
      <line x1={m.l} x2={W - m.r} y1={y(h)} y2={y(h)} stroke={PINKLINE} strokeWidth={1}
        strokeDasharray="2 4" strokeLinecap="round" />
      <text x={m.l + 2} y={y(h) - 5} fontSize={F}
        fill={cusum[cusum.length - 1] > h ? "#fca5a5" : "rgba(252,165,165,0.55)"}
        fontWeight={cusum[cusum.length - 1] > h ? 700 : 400}>{limitText}</text>
      {cusum[cusum.length - 1] > h ? (
        <g>
          <circle cx={m.l - 20} cy={y(h)} r={6} fill={BAD} />
          <text x={m.l - 20} y={y(h) + 3.2} textAnchor="middle" fontSize={8.5}
            fontWeight={700} fill="var(--page-bg)">!</text>
        </g>
      ) : null}
      <Grad id={gid} color={LINE} />
      <path d={`${line} L${xs[xs.length - 1].toFixed(1)} ${y(0).toFixed(1)} L${xs[0].toFixed(1)} ${y(0).toFixed(1)} Z`}
        fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={LINE} strokeWidth={2.2} strokeLinejoin="round" />
      {crossIdx >= 0 ? (
        <g>
          {/* Firing marker: red while the alarm is live, pink once it decayed. */}
          <circle cx={xs[crossIdx]} cy={ys[crossIdx]} r={4}
            fill={cusum[cusum.length - 1] > h ? BAD : PINK}
            stroke="var(--page-bg)" strokeWidth={1.5} />
          <text
            x={Math.min(xs[crossIdx], W - m.r - 4)} y={Math.max(ys[crossIdx] - 9, 10)}
            fontSize={F} fill={cusum[cusum.length - 1] > h ? BAD : PINK} textAnchor="end"
          >{`${alarmText} ${labels[crossIdx]}`}</text>
        </g>
      ) : null}
      {tickIdx(labels.length, 3).map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{labels[i]}</text>
      ))}
      {cusum.map((_, i) => (
        <Hit key={`h${i}`} x={xs[i]} y={ys[i]} tip={tips[i]} api={api} />
      ))}
    </svg>,
  );
}

// ── Daily rhythm vs 7-day rolling mean — crosshair + snapped readout ────────

export function DailyRollingChart({
  days, daily, rolling, endLabel, tips, deltas,
}: {
  days: string[];
  daily: number[];
  rolling: (number | null)[];
  endLabel: string;
  tips: ChartTip[];
  deltas?: DeltaLayerData | null;
}) {
  const api = useChartTip();
  const gid = useGradId();
  const reveal = useHoverReveal();
  const [cross, setCross] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 720, H = 190, m = { l: 36, r: 64, t: 12, b: 22 };
  const all = daily.concat(rolling.filter((v): v is number => v != null));
  const [d0, d1] = pad([Math.min(...all), Math.max(...all)], 0.1);
  const x = lin(0, Math.max(daily.length - 1, 1), m.l, W - m.r);
  const y = lin(d0, d1, H - m.b, m.t);
  const xs = daily.map((_, i) => x(i));
  const rollXs: number[] = [];
  const rollYs: number[] = [];
  rolling.forEach((v, i) => {
    if (v == null) return;
    rollXs.push(xs[i]);
    rollYs.push(y(v));
  });
  const rollLine = smoothPath(rollXs, rollYs);
  const lastRoll: { x: number; y: number } | null =
    rollXs.length > 0 ? { x: rollXs[rollXs.length - 1], y: rollYs[rollYs.length - 1] } : null;
  const yticks = [d0 + (d1 - d0) * 0.15, (d0 + d1) / 2, d1 - (d1 - d0) * 0.15].map(Math.round);

  const onMove = (e: PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(daily.length - 1,
      Math.round(((px - m.l) / (W - m.r - m.l)) * (daily.length - 1))));
    setCross(i);
    api.show(e, tips[i]);
  };

  return api.wrap(
    <svg ref={svgRef} className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%" {...reveal.handlers}>
      {yticks.map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">{g.toLocaleString("en-US")}</text>
        </g>
      ))}
      <path d={smoothPath(xs, daily.map((v) => y(v)))} fill="none" stroke={MUTED} strokeWidth={1.2} strokeLinejoin="round" />
      {rollXs.length > 1 ? (
        <>
          <Grad id={gid} color={LINE} />
          <path
            d={`${rollLine} L ${rollXs[rollXs.length - 1].toFixed(1)} ${H - m.b} L ${rollXs[0].toFixed(1)} ${H - m.b} Z`}
            fill={`url(#${gid})`}
          />
          <path d={rollLine} fill="none" stroke={LINE} strokeWidth={2.4} strokeLinejoin="round" />
        </>
      ) : null}
      {lastRoll !== null ? (
        <g>
          <circle cx={lastRoll.x} cy={lastRoll.y} r={3.5} fill={LINE} stroke="var(--page-bg)" strokeWidth={1.5} />
          <text x={lastRoll.x + 8} y={lastRoll.y + 3} fontSize={F} fill="var(--t2)">{endLabel}</text>
        </g>
      ) : null}
      {tickIdx(days.length, 4).map((i) => (
        <text key={i} x={xs[i]} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{weekLabel(days[i])}</text>
      ))}
      {deltas && rollXs.length >= 3 ? (
        <DeltaLayer show={reveal.show} deltas={deltas}
          avgY={y(deltas.avg)} x0={m.l} x1={W - m.r}
          first={{ x: rollXs[0], y: rollYs[0] }}
          prev={{ x: rollXs[rollXs.length - 2], y: rollYs[rollYs.length - 2] }}
          chipY={0} />
      ) : null}
      {cross != null ? (
        <>
          <line x1={xs[cross]} x2={xs[cross]} y1={m.t} y2={H - m.b} stroke={CENTRE} strokeWidth={1} />
          <circle cx={xs[cross]} cy={y(daily[cross])} r={3.5} fill={MUTED}
            stroke="var(--page-bg)" strokeWidth={1.5} />
          {rolling[cross] != null ? (
            <circle cx={xs[cross]} cy={y(rolling[cross] as number)} r={3.5} fill={LINE}
              stroke="var(--page-bg)" strokeWidth={1.5} />
          ) : null}
        </>
      ) : null}
      <rect
        x={m.l} y={m.t} width={W - m.r - m.l} height={H - m.t - m.b} fill="transparent"
        onPointerMove={onMove}
        onPointerLeave={() => { setCross(null); api.hide(); }}
      />
    </svg>,
  );
}

// ── Closed-week columns + marked partial week ───────────────────────────────

export function WeeklyColumns({
  labels, values, partialValue, partialLabel, partialTag, tips, partialTip, deltas,
}: {
  labels: string[];
  values: number[];
  partialValue: number | null;
  partialLabel: string;
  partialTag: string;
  tips: ChartTip[];
  partialTip: ChartTip | null;
  deltas?: DeltaLayerData | null;
}) {
  const api = useChartTip();
  const reveal = useHoverReveal();
  const W = 360, H = 200, m = { l: 34, r: 6, t: 20, b: 22 };
  const n = values.length + (partialValue != null ? 1 : 0);
  const hi = Math.max(...values, partialValue ?? 0) * 1.12 || 1;
  const y = lin(0, hi, H - m.b, m.t);
  const x = lin(0, Math.max(n - 1, 1), m.l + 12, W - m.r - 12);
  const bw = Math.min(14, ((W - m.l - m.r) / Math.max(n, 1)) * 0.6);

  const hit = (i: number, tip: ChartTip) => (
    <rect
      key={`h${i}`} x={x(i) - bw} y={m.t} width={bw * 2} height={H - m.t - m.b}
      fill="transparent" tabIndex={0} style={{ outline: "none" }}
      onPointerEnter={(e) => api.show(e, tip)}
      onPointerMove={(e) => api.show(e, tip)}
      onPointerLeave={api.hide}
      onFocus={(e) => api.showFocus(e, tip)}
      onBlur={api.hide}
    />
  );

  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%" {...reveal.handlers}>
      {[0, hi / 2, hi].map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">
            {Math.round(g).toLocaleString("en-US")}
          </text>
        </g>
      ))}
      {values.map((v, i) => (
        <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw}
          height={Math.max(y(0) - y(v), 1)} fill={LINE} rx={2} opacity={0.85} />
      ))}
      {partialValue != null ? (
        <g>
          <rect x={x(n - 1) - bw / 2} y={y(partialValue)} width={bw}
            height={Math.max(y(0) - y(partialValue), 1)}
            fill="rgba(127,176,201,0.14)" stroke={MUTED} strokeWidth={1.2}
            strokeDasharray="4 3" rx={2} />
          <text x={x(n - 1)} y={y(partialValue) - 6} fontSize={F} fill={AX} textAnchor="middle">
            {partialTag}
          </text>
        </g>
      ) : null}
      {tickIdx(labels.length, 3).map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{labels[i]}</text>
      ))}
      {partialValue != null ? (
        <text x={x(n - 1)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{partialLabel}</text>
      ) : null}
      {deltas && values.length >= 3 ? (
        <DeltaLayer show={reveal.show} deltas={deltas}
          avgY={y(deltas.avg)} x0={m.l} x1={W - m.r}
          first={{ x: x(0), y: y(values[0]) }}
          prev={{ x: x(values.length - 2), y: y(values[values.length - 2]) }}
          chipY={1} />
      ) : null}
      {values.map((_, i) => hit(i, tips[i]))}
      {partialValue != null && partialTip ? hit(n - 1, partialTip) : null}
    </svg>,
  );
}

// ── Same-weekday strip ──────────────────────────────────────────────────────

export function WeekdayStrip({
  values, current, currentText, tips, currentTip,
}: {
  values: number[];
  current: number;
  currentText: string;
  tips: ChartTip[];
  currentTip: ChartTip;
}) {
  const api = useChartTip();
  const W = 360, H = 96;
  const all = values.concat([current]);
  const [d0, d1] = pad([Math.min(...all), Math.max(...all)], 0.18);
  const x = lin(d0, d1, 22, W - 22);
  const yMid = 56;
  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      <line x1={10} x2={W - 10} y1={yMid} y2={yMid} stroke={GRID} strokeWidth={1.2} />
      {values.map((v, i) => (
        <circle key={i} cx={x(v)} cy={yMid} r={4.5} fill={MUTED}
          stroke="var(--page-bg)" strokeWidth={1.5} />
      ))}
      <circle cx={x(current)} cy={yMid} r={5.5} fill={LINE} stroke="var(--page-bg)" strokeWidth={1.5} />
      <text x={x(current)} y={yMid - 13} fontSize={F} fill="var(--t2)" textAnchor="middle">
        {`${currentText} · ${Math.round(current).toLocaleString("en-US")}`}
      </text>
      <text x={x(Math.min(...all))} y={yMid + 20} fontSize={F} fill={AX} textAnchor="middle">
        {Math.round(Math.min(...all)).toLocaleString("en-US")}
      </text>
      <text x={x(Math.max(...all))} y={yMid + 20} fontSize={F} fill={AX} textAnchor="middle">
        {Math.round(Math.max(...all)).toLocaleString("en-US")}
      </text>
      {values.map((v, i) => (
        <Hit key={`h${i}`} x={x(v)} y={yMid} tip={tips[i]} api={api} />
      ))}
      <Hit x={x(current)} y={yMid} r={14} tip={currentTip} api={api} />
    </svg>,
  );
}

// ── Funnel plot ─────────────────────────────────────────────────────────────

export function FunnelPlot({
  points, p0, latestIdx, overallText, axisText, signalText, tips,
}: {
  points: { n: number; p: number }[];
  p0: number;
  latestIdx: number;
  overallText: string;
  axisText: string;
  signalText: string;
  tips: ChartTip[];
}) {
  const api = useChartTip();
  const W = 720, H = 230, m = { l: 40, r: 96, t: 12, b: 34 };
  const maxN = Math.max(...points.map((q) => q.n), 50) * 1.15;
  const se = (nn: number) => Math.sqrt((p0 * (1 - p0)) / Math.max(nn, 1));
  const minN = Math.max(10, Math.min(...points.map((q) => q.n)) * 0.5);
  const maxP = Math.max(...points.map((q) => q.p), p0 + 3.2 * se(minN)) * 1.1;
  const x = lin(0, maxN, m.l, W - m.r);
  const y = lin(0, maxP, H - m.b, m.t);

  const curve = (z: number, side: 1 | -1) => {
    let d = "";
    for (let nn = minN; nn <= maxN; nn += Math.max((maxN - minN) / 90, 1)) {
      const v = Math.min(Math.max(p0 + side * z * se(nn), 0), maxP);
      d += `${d ? "L" : "M"}${x(nn).toFixed(1)} ${y(v).toFixed(1)}`;
    }
    return d;
  };
  const outside3 = (q: { n: number; p: number }) => Math.abs(q.p - p0) > 3 * se(q.n);
  const firstBad = points.findIndex(outside3);
  const yticks = [0, maxP / 2, maxP];

  return api.wrap(
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {yticks.map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">
            {`${(g * 100).toFixed(1)}%`}
          </text>
        </g>
      ))}
      <path d={curve(3, 1)} fill="none" stroke={GRID} strokeWidth={1.2} />
      <path d={curve(3, -1)} fill="none" stroke={GRID} strokeWidth={1.2} />
      <path d={curve(2, 1)} fill="none" stroke={CENTRE} strokeWidth={1} opacity={0.5} />
      <path d={curve(2, -1)} fill="none" stroke={CENTRE} strokeWidth={1} opacity={0.5} />
      <line x1={m.l} x2={W - m.r} y1={y(p0)} y2={y(p0)} stroke={CENTRE} strokeWidth={1.2} />
      <text x={W - m.r + 6} y={y(p0) + 3} fontSize={F} fill="var(--t2)">
        {`${overallText} ${(p0 * 100).toFixed(1)}%`}
      </text>
      <text x={x(180)} y={y(Math.min(p0 + 2 * se(180), maxP)) - 8} fontSize={F} fill={AX}>2σ</text>
      <text x={x(120)} y={y(Math.min(p0 + 3 * se(120), maxP)) + 14} fontSize={F} fill={AX}>3σ</text>
      {points.map((q, i) => {
        const isBad = outside3(q);
        const isLatest = i === latestIdx;
        // Neutral weeks are light blue; an outlier is red only if it IS the
        // latest week — otherwise it is history and wears pink.
        const fill = isBad
          ? (isLatest ? BAD : PINK)
          : isLatest ? GOOD : "rgba(127,176,201,0.65)";
        return (
          <circle key={i} cx={x(q.n)} cy={y(q.p)} r={isBad || isLatest ? 4.5 : 3.5}
            fill={fill} stroke="var(--page-bg)" strokeWidth={1.5} />
        );
      })}
      {firstBad >= 0 ? (
        <text
          x={Math.min(x(points[firstBad].n), W - m.r - 4)}
          y={y(points[firstBad].p) + 16} fontSize={F} fill={BAD} textAnchor="end"
        >{signalText}</text>
      ) : null}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={x(maxN * f)} y={H - 18} fontSize={F} fill={AX} textAnchor="middle">
          {Math.round(maxN * f).toLocaleString("en-US")}
        </text>
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 4} fontSize={F} fill={AX} textAnchor="middle">{axisText}</text>
      {points.map((q, i) => (
        <Hit key={`h${i}`} x={x(q.n)} y={y(q.p)} tip={tips[i]} api={api} />
      ))}
    </svg>,
  );
}
