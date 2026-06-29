/**
 * Presentational SVG primitives for the insights dashboard. Server components:
 * all geometry is computed at render time from real data, so the markup ships
 * fully drawn. The reveal animation is pure CSS (toggled by the .go class on
 * an ancestor — see _reveal.tsx and insights.css).
 */

import type { CSSProperties, ReactNode } from "react";
import {
  Monitor,
  Smartphone,
  Tablet,
  Tv,
  MonitorSmartphone,
  type LucideIcon,
} from "lucide-react";
import {
  RING_VIEWBOX,
  arc,
  donutSplit,
  donutSingle,
  gauge,
  areaChart,
  sparkline,
} from "./geometry";

const TRACK = "rgba(255,255,255,0.08)";

// ── Device glyphs ────────────────────────────────────────────────────────────
// GA4 device categories → an icon (desktop = monitor, mobile = phone, …). Drawn
// in the segment's own color, in place of the legend dot.
const DEVICE_ICONS: Record<string, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  "smart tv": Tv,
};

export function DeviceGlyph({
  category,
  color,
}: {
  category: string;
  color: string;
}) {
  const Glyph = DEVICE_ICONS[category.trim().toLowerCase()] ?? MonitorSmartphone;
  return (
    <Glyph size={14} strokeWidth={1.8} color={color} style={{ flexShrink: 0 }} />
  );
}

/** Proper-case a label: "smart tv" → "Smart Tv", "desktop" → "Desktop". */
export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}

/** Compact money, no decimals for whole amounts: 14820 → "$14,820". */
export function fmtMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

/** Signed percentage-point delta for ratios: 0.012 → "+1.2 pts". */
export function fmtSignedPp(pp: number, digits = 1): string {
  const s = pp >= 0 ? "+" : "";
  return `${s}${pp.toFixed(digits)} pts`;
}

/** Unsigned percentage-point magnitude (direction comes from the delta arrow). */
export function fmtPp(pp: number, digits = 1): string {
  return `${Math.abs(pp).toFixed(digits)} pts`;
}

/** Chart color matching a delta: green up, red down, neutral when flat.
 *  Same thresholds as DeltaPill so the line agrees with the pill. */
export function deltaColor(pct: number): string {
  return pct > 0.05 ? "var(--success)" : pct < -0.05 ? "var(--danger)" : "var(--t3)";
}

/** Signed trend of a series (last − first) — feeds deltaColor for charts that
 *  show history but no explicit delta pill (e.g. the funnel tiles). */
export function seriesTrend(s: number[]): number {
  return s.length < 2 ? 0 : s[s.length - 1] - s[0];
}

export function fmtSignedPct(pct: number, digits = 1): string {
  const s = pct >= 0 ? "+" : "";
  return `${s}${pct.toFixed(digits)}%`;
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function fmtDelta(pct: number): string {
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "·";
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

// ── Delta pill ───────────────────────────────────────────────────────────────

export function DeltaPill({
  pct,
  label,
}: {
  pct: number;
  label?: string;
}) {
  const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  const text = label ?? `${Math.abs(pct).toFixed(1)}%`;
  return (
    <span className={`delta ${dir}`}>
      {dir !== "flat" ? (
        <svg viewBox="0 0 10 10" width="9" height="9" fill="currentColor" aria-hidden="true">
          {dir === "up" ? <path d="M5 2.5 L8.5 7.5 L1.5 7.5 Z" /> : <path d="M5 7.5 L8.5 2.5 L1.5 2.5 Z" />}
        </svg>
      ) : null}
      {text}
    </span>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

export function DonutSplit({
  frac,
  colorA,
  colorB,
}: {
  frac: number;
  colorA: string;
  colorB: string;
}) {
  const { a, b } = donutSplit(frac);
  return (
    <svg viewBox={RING_VIEWBOX}>
      <circle cx={50} cy={50} r={38} fill="none" stroke={TRACK} strokeWidth={11} />
      <path
        d={a}
        className="seg"
        pathLength={1}
        fill="none"
        stroke={colorA}
        strokeWidth={11}
        strokeLinecap="round"
      />
      <path
        d={b}
        className="seg"
        pathLength={1}
        fill="none"
        stroke={colorB}
        strokeWidth={11}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DonutSingle({
  frac,
  color,
}: {
  frac: number;
  color: string;
}) {
  return (
    <svg viewBox={RING_VIEWBOX}>
      <circle cx={50} cy={50} r={38} fill="none" stroke={TRACK} strokeWidth={11} />
      <path
        d={donutSingle(frac)}
        className="seg"
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth={11}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** N-segment donut (whole partitioned across `segments`) with a small gap
 *  between arcs. Tiny slices keep a reduced gap so they stay visible. */
export function DonutMulti({
  segments,
  gap = 4,
}: {
  segments: { value: number; color: string }[];
  gap?: number;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const arcs: { d: string; color: string }[] = [];
  if (total > 0) {
    let acc = 0;
    for (const seg of segments) {
      const v = Math.max(0, seg.value);
      if (v <= 0) continue;
      const a0 = (acc / total) * 360;
      acc += v;
      const a1 = (acc / total) * 360;
      const span = a1 - a0;
      const g = Math.min(gap, span * 0.6); // shrink the gap for slivers
      arcs.push({ d: arc(a0 + g / 2, a1 - g / 2), color: seg.color });
    }
  }
  return (
    <svg viewBox={RING_VIEWBOX}>
      <circle cx={50} cy={50} r={38} fill="none" stroke={TRACK} strokeWidth={11} />
      {arcs.map((a, i) => (
        <path
          key={i}
          d={a.d}
          className="seg"
          pathLength={1}
          fill="none"
          stroke={a.color}
          strokeWidth={11}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────

export function GaugeArc({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const { track, value: val } = gauge(value, max);
  return (
    <svg viewBox={RING_VIEWBOX}>
      <path
        d={track}
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d={val}
        className="seg"
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Area chart ───────────────────────────────────────────────────────────────

let gradSeq = 0;

export function AreaChartSvg({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const chart = areaChart(values);
  if (!chart) return null;
  const gradId = `gro-grad-${gradSeq++}`;
  const { width: w, height: h } = chart;
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[1, 2, 3].map((i) => (
        <line
          key={i}
          x1={0}
          y1={(i / 4) * h}
          x2={w}
          y2={(i / 4) * h}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
        />
      ))}
      <path d={chart.fill} className="fill" fill={`url(#${gradId})`} />
      <path d={chart.stroke} className="stroke" pathLength={1} stroke={color} />
      <circle
        cx={chart.end.x}
        cy={chart.end.y}
        r={2.5}
        fill={color}
        className="enddot"
      />
    </svg>
  );
}

// ── Sparkline (depth tile) ───────────────────────────────────────────────────

export function Sparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const sp = sparkline(values);
  if (!sp) return null;
  // Fade via a gradient (like AreaChartSvg). The old `${color}22` trick only
  // works for hex colors — with the CSS-variable colors these tiles pass
  // (var(--accent), …) it produced an invalid fill and fell back to black.
  const gradId = `gro-spark-${gradSeq++}`;
  return (
    <svg
      className="mspark"
      viewBox="0 0 300 26"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={sp.area} className="ar" style={{ fill: `url(#${gradId})`, stroke: "none" }} />
      <path d={sp.line} className="ln" stroke={color} />
    </svg>
  );
}

// ── Stacked horizontal bars ──────────────────────────────────────────────────

export interface StackRow {
  name: string;
  valueLabel: string;
  color: string;
  value: number;
}

export function StackBars({ rows }: { rows: StackRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div className="stack-row" key={`${r.name}-${i}`}>
          <div className="stack-top">
            <span className="stack-name">
              <span className="dot" style={{ background: r.color }} />
              <span className="nm">{r.name}</span>
            </span>
            <span className="stack-val">{r.valueLabel}</span>
          </div>
          <div className="stack-track">
            <div
              className="stack-fill"
              style={
                {
                  "--w": `${((r.value / max) * 100).toFixed(1)}%`,
                  background: r.color,
                } as CSSProperties
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Segmented bar (device mix) ───────────────────────────────────────────────

export interface SegRow {
  name: string;
  valueLabel: string;
  pcLabel: string;
  color: string;
  share: number; // 0..1
  /** Optional glyph rendered in place of the legend dot (e.g. a device icon). */
  icon?: ReactNode;
}

export function SegBar({ rows }: { rows: SegRow[] }) {
  return (
    <>
      <div className="segbar">
        {rows.map((r, i) => (
          <span
            key={`${r.name}-${i}`}
            style={
              {
                "--w": `${(r.share * 100).toFixed(1)}%`,
                background: r.color,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="seglist">
        {rows.map((r, i) => (
          <div className="r" key={`${r.name}-leg-${i}`}>
            {r.icon ?? <span className="dot" style={{ background: r.color }} />}
            <span className="nm">{r.name}</span>
            <span className="vv">{r.valueLabel}</span>
            <span className="pc">{r.pcLabel}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Page table ───────────────────────────────────────────────────────────────

export interface PtableRow {
  path: string;
  valueLabel: string;
  deltaPct: number;
}

export function Ptable({
  headers,
  rows,
}: {
  headers: [string, string, string];
  rows: PtableRow[];
}) {
  return (
    <div className="ptable">
      <div className="ph">
        <span>{headers[0]}</span>
        <span>{headers[1]}</span>
        <span>{headers[2]}</span>
      </div>
      {rows.map((r, i) => {
        const color =
          r.deltaPct > 0.05
            ? "var(--success)"
            : r.deltaPct < -0.05
              ? "var(--danger)"
              : "var(--t3)";
        return (
          <div className="pr" key={`${r.path}-${i}`}>
            <span className="pp">{r.path}</span>
            <span className="pv">{r.valueLabel}</span>
            <span className="pd" style={{ color }}>
              {fmtDelta(r.deltaPct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── "Próximamente" skeletons (no fake numbers) ───────────────────────────────

export function SoonBars({ n = 4 }: { n?: number }) {
  const widths = ["72%", "54%", "88%", "40%", "63%"];
  return (
    <div className="soon-skel">
      {Array.from({ length: n }).map((_, i) => (
        <div className="bar" key={i} style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

export function SoonRing() {
  return (
    <div className="ringwrap">
      <div className="soon-ring" />
      <div className="soon-skel" style={{ gap: 10 }}>
        <div className="bar" style={{ width: "70%" }} />
        <div className="bar" style={{ width: "50%" }} />
      </div>
    </div>
  );
}
