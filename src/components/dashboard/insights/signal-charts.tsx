/**
 * SVG chart primitives for the Signals dashboard — server components, fully
 * drawn at render time from real data (same philosophy as charts.tsx). These
 * are the "different kind of graphs" from the signal-based analytics design
 * session: process-behaviour (XmR) charts, CUSUM drift charts, WoW-delta bars,
 * daily-vs-rolling rhythm, closed-week columns with a marked partial week, and
 * a Spiegelhalter funnel plot.
 *
 * All user-visible copy arrives via props (i18n stays in the page). Date/number
 * labels are data-derived. Unlike the sparkline tiles these keep a fixed aspect
 * (no preserveAspectRatio="none") because they carry text.
 */

const AX = "var(--t3)";
const GRID = "rgba(255,255,255,0.06)";
const CENTRE = "rgba(237,234,224,0.45)";
const BAND = "rgba(255,255,255,0.05)";
const LINE = "var(--blue)";
const BAD = "var(--danger-solid)";
const GOOD = "var(--success)";
const MUTED = "rgba(237,234,224,0.35)";

const F = 9.5; // base SVG font size

function lin(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function pad([lo, hi]: [number, number], frac = 0.12): [number, number] {
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * frac, hi + span * frac];
}

function path(xs: number[], ys: number[]): string {
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i ? "L" : "M"}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`;
  return d;
}

/** Midpoint-cubic smoothing (same construction as geometry.ts `smooth`) —
 *  the curve still passes exactly through every data point. */
function smoothPath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return "";
  if (xs.length === 1) return `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  let d = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const mx = ((xs[i] + xs[i + 1]) / 2).toFixed(1);
    d += ` C ${mx} ${ys[i].toFixed(1)} ${mx} ${ys[i + 1].toFixed(1)} ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

// Gradient area fade under a line (the Overview dashboard's chart language).
let gradSeq = 0;

function Grad({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.22} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/** Sparse tick indexes: first, last, and ~n evenly between. */
function tickIdx(len: number, n = 4): number[] {
  if (len <= n) return Array.from({ length: len }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(Math.round((i / (n - 1)) * (len - 1)));
  return [...out].sort((a, b) => a - b);
}

/** "May 4" from YYYY-MM-DD. */
export function weekLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

// ── Process-behaviour (XmR) chart ───────────────────────────────────────────

export function ControlChart({
  labels, values, cl, ucl, lcl, badIdx, fmt,
  centreText, upperText, lowerText, signalText,
}: {
  labels: string[];
  values: number[];
  cl: number; ucl: number; lcl: number;
  /** Indexes rendered as signals (outside limits on the bad side). */
  badIdx: number[];
  fmt: (v: number) => string;
  centreText: string; upperText: string; lowerText: string; signalText: string;
}) {
  const W = 720, H = 210, m = { l: 8, r: 118, t: 14, b: 24 };
  const lo = Math.min(...values, lcl), hi = Math.max(...values, ucl);
  const [d0, d1] = pad([lo, hi]);
  const x = lin(0, Math.max(values.length - 1, 1), m.l + 8, W - m.r - 8);
  const y = lin(d0, d1, H - m.b, m.t);
  const xs = values.map((_, i) => x(i));
  const ys = values.map((v) => y(v));
  const bad = new Set(badIdx);
  const lx = W - m.r + 6;

  return (
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      <rect x={m.l} y={y(ucl)} width={W - m.r - m.l} height={Math.max(y(lcl) - y(ucl), 0)} fill={BAND} rx={2} />
      <line x1={m.l} x2={W - m.r} y1={y(cl)} y2={y(cl)} stroke={CENTRE} strokeWidth={1.2} />
      <line x1={m.l} x2={W - m.r} y1={y(ucl)} y2={y(ucl)} stroke={GRID} strokeWidth={1} />
      <line x1={m.l} x2={W - m.r} y1={y(lcl)} y2={y(lcl)} stroke={GRID} strokeWidth={1} />
      <text x={lx} y={y(ucl) + 3} fontSize={F} fill={AX}>{`${upperText} ${fmt(ucl)}`}</text>
      <text x={lx} y={y(cl) + 3} fontSize={F} fill="var(--t2)">{`${centreText} ${fmt(cl)}`}</text>
      <text x={lx} y={y(lcl) + 3} fontSize={F} fill={AX}>{`${lowerText} ${fmt(lcl)}`}</text>

      <Grad id={`sig-grad-cc-${gradSeq++}`} color={LINE} />
      <path
        d={`${smoothPath(xs, ys)} L ${xs[xs.length - 1].toFixed(1)} ${H - m.b} L ${xs[0].toFixed(1)} ${H - m.b} Z`}
        fill={`url(#sig-grad-cc-${gradSeq - 1})`}
      />
      <path d={smoothPath(xs, ys)} fill="none" stroke={LINE} strokeWidth={2.2}
        strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r={bad.has(i) ? 4 : 3}
          fill={bad.has(i) ? BAD : LINE} stroke="var(--page-bg)" strokeWidth={1.5} />
      ))}
      {badIdx.length > 0 ? (
        <text
          x={Math.min(xs[badIdx[0]], W - m.r - 4)} y={ys[badIdx[0]] + 16}
          fontSize={F} fill={BAD} textAnchor="end"
        >{signalText}</text>
      ) : null}

      {tickIdx(labels.length).map((i) => (
        <text key={i} x={xs[i]} y={H - 8} fontSize={F} fill={AX} textAnchor="middle">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

// ── Week-over-week delta bars (the detector that misses slow drift) ─────────

export function WowBars({
  labels, wow, thresholdPct, thresholdText,
}: {
  labels: string[];
  wow: (number | null)[];
  /** The signed point-alarm threshold on the BAD side (e.g. −5 or +5). */
  thresholdPct: number;
  thresholdText: string;
}) {
  const W = 360, H = 190, m = { l: 34, r: 6, t: 12, b: 22 };
  const mag = Math.max(8, ...wow.map((v) => Math.abs(v ?? 0)), Math.abs(thresholdPct) + 2);
  const y = lin(-mag, mag, H - m.b, m.t);
  const x = lin(0, Math.max(wow.length - 1, 1), m.l + 10, W - m.r - 10);
  const bw = Math.min(10, ((W - m.l - m.r) / Math.max(wow.length, 1)) * 0.55);

  return (
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {[-mag, 0, mag].map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">
            {`${g > 0 ? "+" : ""}${Math.round(g)}%`}
          </text>
        </g>
      ))}
      <line x1={m.l} x2={W - m.r} y1={y(thresholdPct)} y2={y(thresholdPct)} stroke={BAD} strokeWidth={1.2} />
      <text
        x={W - m.r} y={y(thresholdPct) + (thresholdPct < 0 ? 11 : -5)}
        fontSize={F} fill={BAD} textAnchor="end"
      >{thresholdText}</text>
      {wow.map((v, i) => {
        if (v == null) return null;
        const y0 = y(0), y1 = y(v);
        return (
          <rect key={i} x={x(i) - bw / 2} y={Math.min(y0, y1)}
            width={bw} height={Math.max(Math.abs(y1 - y0), 1)}
            fill={MUTED} rx={1.5} />
        );
      })}
      {tickIdx(labels.length, 3).map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{labels[i]}</text>
      ))}
    </svg>
  );
}

// ── CUSUM drift chart ───────────────────────────────────────────────────────

export function CusumChart({
  labels, cusum, h, crossIdx, limitText, alarmText,
}: {
  labels: string[];
  cusum: number[];
  h: number;
  crossIdx: number;
  limitText: string;
  alarmText: string;
}) {
  const W = 360, H = 190, m = { l: 34, r: 6, t: 14, b: 22 };
  const hi = Math.max(...cusum, h) * 1.15 || 1;
  const y = lin(0, hi, H - m.b, m.t);
  const x = lin(0, Math.max(cusum.length - 1, 1), m.l + 10, W - m.r - 10);
  const xs = cusum.map((_, i) => x(i));
  const ys = cusum.map((v) => y(v));
  const line = smoothPath(xs, ys);

  return (
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {[0, hi / 2, hi].map((g, gi) => (
        <line key={gi} x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)}
          stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
      ))}
      <line x1={m.l} x2={W - m.r} y1={y(h)} y2={y(h)} stroke={BAD} strokeWidth={1.2} />
      <text x={m.l + 2} y={y(h) - 5} fontSize={F} fill={BAD}>{limitText}</text>
      <Grad id={`sig-grad-cu-${gradSeq++}`} color={LINE} />
      <path d={`${line} L${xs[xs.length - 1].toFixed(1)} ${y(0).toFixed(1)} L${xs[0].toFixed(1)} ${y(0).toFixed(1)} Z`}
        fill={`url(#sig-grad-cu-${gradSeq - 1})`} />
      <path d={line} fill="none" stroke={LINE} strokeWidth={2.2} strokeLinejoin="round" />
      {crossIdx >= 0 ? (
        <g>
          <circle cx={xs[crossIdx]} cy={ys[crossIdx]} r={4} fill={BAD}
            stroke="var(--page-bg)" strokeWidth={1.5} />
          <text
            x={Math.min(xs[crossIdx], W - m.r - 4)} y={Math.max(ys[crossIdx] - 9, 10)}
            fontSize={F} fill={BAD} textAnchor="end"
          >{`${alarmText} ${labels[crossIdx]}`}</text>
        </g>
      ) : null}
      {tickIdx(labels.length, 3).map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{labels[i]}</text>
      ))}
    </svg>
  );
}

// ── Daily rhythm vs 7-day rolling mean ──────────────────────────────────────

export function DailyRollingChart({
  days, daily, rolling, endLabel,
}: {
  days: string[];
  daily: number[];
  rolling: (number | null)[];
  /** Preformatted end-of-line label, e.g. "182/day". */
  endLabel: string;
}) {
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

  return (
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {yticks.map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">{g.toLocaleString("en-US")}</text>
        </g>
      ))}
      <path d={smoothPath(xs, daily.map((v) => y(v)))} fill="none" stroke={MUTED} strokeWidth={1.2} strokeLinejoin="round" />
      {rollXs.length > 1 ? (
        <>
          <Grad id={`sig-grad-rr-${gradSeq++}`} color={LINE} />
          <path
            d={`${rollLine} L ${rollXs[rollXs.length - 1].toFixed(1)} ${H - m.b} L ${rollXs[0].toFixed(1)} ${H - m.b} Z`}
            fill={`url(#sig-grad-rr-${gradSeq - 1})`}
          />
          <path d={rollLine} fill="none" stroke={LINE} strokeWidth={2.4} strokeLinejoin="round" />
        </>
      ) : null}
      {lastRoll !== null ? (
        <g>
          <circle cx={(lastRoll as { x: number; y: number }).x} cy={(lastRoll as { x: number; y: number }).y}
            r={3.5} fill={LINE} stroke="var(--page-bg)" strokeWidth={1.5} />
          <text x={(lastRoll as { x: number; y: number }).x + 8} y={(lastRoll as { x: number; y: number }).y + 3}
            fontSize={F} fill="var(--t2)">{endLabel}</text>
        </g>
      ) : null}
      {tickIdx(days.length, 4).map((i) => (
        <text key={i} x={xs[i]} y={H - 6} fontSize={F} fill={AX} textAnchor="middle">{weekLabel(days[i])}</text>
      ))}
    </svg>
  );
}

// ── Closed-week columns + marked partial week ───────────────────────────────

export function WeeklyColumns({
  labels, values, partialValue, partialLabel, partialTag, fmt,
}: {
  labels: string[];
  values: number[];
  partialValue: number | null;
  partialLabel: string;
  partialTag: string;
  fmt: (v: number) => string;
}) {
  const W = 360, H = 200, m = { l: 34, r: 6, t: 20, b: 22 };
  const n = values.length + (partialValue != null ? 1 : 0);
  const hi = Math.max(...values, partialValue ?? 0) * 1.12 || 1;
  const y = lin(0, hi, H - m.b, m.t);
  const x = lin(0, Math.max(n - 1, 1), m.l + 12, W - m.r - 12);
  const bw = Math.min(14, ((W - m.l - m.r) / Math.max(n, 1)) * 0.6);

  return (
    <svg className="sigchart" viewBox={`0 0 ${W} ${H}`} width="100%">
      {[0, hi / 2, hi].map((g, gi) => (
        <g key={gi}>
          <line x1={m.l} x2={W - m.r} y1={y(g)} y2={y(g)} stroke={g === 0 ? CENTRE : GRID} strokeWidth={1} />
          <text x={m.l - 4} y={y(g) + 3} fontSize={F} fill={AX} textAnchor="end">{fmt(g)}</text>
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
    </svg>
  );
}

// ── Same-weekday strip ──────────────────────────────────────────────────────

export function WeekdayStrip({
  values, current, currentText,
}: {
  /** Prior same-weekday values, ascending in time. */
  values: number[];
  current: number;
  currentText: string;
}) {
  const W = 360, H = 96;
  const all = values.concat([current]);
  const [d0, d1] = pad([Math.min(...all), Math.max(...all)], 0.18);
  const x = lin(d0, d1, 22, W - 22);
  const yMid = 56;
  return (
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
    </svg>
  );
}

// ── Funnel plot (rate vs denominator, limits widen as n shrinks) ────────────

export function FunnelPlot({
  points, p0, latestIdx, overallText, axisText, signalText,
}: {
  /** Weekly points: n = denominator (e.g. sessions), p = rate 0..1. */
  points: { n: number; p: number }[];
  /** Pooled overall rate 0..1. */
  p0: number;
  latestIdx: number;
  overallText: string;
  axisText: string;
  signalText: string;
}) {
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

  return (
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
      {points.map((q, i) => {
        const bad = outside3(q);
        const isLatest = i === latestIdx;
        return (
          <circle key={i} cx={x(q.n)} cy={y(q.p)} r={bad || isLatest ? 4.5 : 3.5}
            fill={bad ? BAD : isLatest ? GOOD : MUTED}
            stroke="var(--page-bg)" strokeWidth={1.5} />
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
    </svg>
  );
}

// ── Tiny state sparkline for the verdict tiles ──────────────────────────────

export function SignalSpark({
  values, cl, ucl, lcl, endColor,
}: {
  values: number[];
  cl: number | null; ucl: number | null; lcl: number | null;
  endColor: string;
}) {
  if (values.length < 2) return null;
  const W = 300, H = 34, p = 4;
  const all = values.concat(
    cl != null ? [cl] : [], ucl != null ? [ucl] : [], lcl != null ? [lcl] : [],
  );
  const [d0, d1] = pad([Math.min(...all), Math.max(...all)], 0.15);
  const x = lin(0, values.length - 1, p, W - p);
  const y = lin(d0, d1, H - p, p);
  return (
    <svg className="mspark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Normal-range band only — no centre hairline: at sparkline scale it reads
          as a second (baseline) series and fights the value line. The line itself
          wears the state color so it contrasts with the band. */}
      {ucl != null && lcl != null ? (
        <rect x={0} y={y(ucl)} width={W} height={Math.max(y(lcl) - y(ucl), 0)} fill={BAND} />
      ) : null}
      <Grad id={`sig-grad-sp-${gradSeq++}`} color={endColor} />
      <path
        d={`${smoothPath(values.map((_, i) => x(i)), values.map((v) => y(v)))} L ${(W - p).toFixed(1)} ${H} L ${p.toFixed(1)} ${H} Z`}
        fill={`url(#sig-grad-sp-${gradSeq - 1})`}
      />
      <path d={smoothPath(values.map((_, i) => x(i)), values.map((v) => y(v)))}
        fill="none" stroke={endColor} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.8} fill={endColor} />
    </svg>
  );
}
