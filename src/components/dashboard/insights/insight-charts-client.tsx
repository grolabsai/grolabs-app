"use client";

/**
 * Interactive variants of the Overview chart primitives (charts.tsx) — same
 * geometry and visual language, hydrated with the shared tooltip layer so
 * every day / segment answers the pointer with a precise readout.
 *
 * Tooltip content (ChartTip) is prebuilt on the server; alignment contract:
 * tips[i] belongs to values[i] / segments[i].
 */

import { useId, useState, useRef, type PointerEvent } from "react";
import { areaChart, sparkline, arc, RING_VIEWBOX } from "./geometry";
import type { ChartTip } from "./signal-chart-util";
import { useChartTip } from "./chart-tip";

const TRACK = "rgba(255,255,255,0.08)";

const useGradId = () => {
  const raw = useId();
  return "ig" + raw.replace(/[^a-zA-Z0-9]/g, "");
};

/** x/y positions matching geometry.ts `coords` (so markers land on the line). */
function pts(vals: number[], w: number, h: number, pad: number) {
  const n = vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  return vals.map((v, i) => ({
    x: pad + (n === 1 ? 0.5 : i / (n - 1)) * (w - 2 * pad),
    y: h - pad - (span > 0 ? (v - min) / span : 0.5) * (h - 2 * pad),
  }));
}

/** Nearest-index snap from a pointer event over a stretched-viewBox svg. */
function snapIndex(
  e: PointerEvent, svg: SVGSVGElement | null, n: number, w: number, pad: number,
): number | null {
  const r = svg?.getBoundingClientRect();
  if (!r || n === 0) return null;
  const px = ((e.clientX - r.left) / r.width) * w;
  return Math.max(0, Math.min(n - 1, Math.round(((px - pad) / (w - 2 * pad)) * (n - 1))));
}

// ── Area chart (Total sales / Sessions / Users timelines) ───────────────────

export function InteractiveArea({
  values, color, tips,
}: {
  values: number[];
  color: string;
  tips: ChartTip[];
}) {
  const api = useChartTip();
  const gid = useGradId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [cross, setCross] = useState<number | null>(null);
  const chart = areaChart(values);
  if (!chart) return null;
  const { width: w, height: h } = chart;
  const pad = 6;
  const p = pts(values, w, h, pad);

  const onMove = (e: PointerEvent) => {
    const i = snapIndex(e, svgRef.current, values.length, w, pad);
    if (i == null || !tips[i]) return;
    setCross(i);
    api.show(e, tips[i]);
  };

  return api.wrap(
    <svg
      ref={svgRef}
      className="chart"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[1, 2, 3].map((i) => (
        <line key={i} x1={0} y1={(i / 4) * h} x2={w} y2={(i / 4) * h}
          stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}
      <path d={chart.fill} className="fill" fill={`url(#${gid})`} />
      <path d={chart.stroke} className="stroke" pathLength={1} stroke={color} />
      <circle cx={chart.end.x} cy={chart.end.y} r={2.5} fill={color} className="enddot" />
      {cross != null ? (
        <>
          <line x1={p[cross].x} x2={p[cross].x} y1={pad} y2={h - pad}
            stroke="rgba(237,234,224,0.35)" strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
          <circle cx={p[cross].x} cy={p[cross].y} r={3} fill={color}
            stroke="var(--page-bg)" strokeWidth={1.5} />
        </>
      ) : null}
      <rect
        x={0} y={0} width={w} height={h} fill="transparent"
        onPointerMove={onMove}
        onPointerLeave={() => { setCross(null); api.hide(); }}
      />
    </svg>,
  );
}

// ── Sparkline (depth tiles) ─────────────────────────────────────────────────

export function InteractiveSparkline({
  values, color, tips,
}: {
  values: number[];
  color: string;
  tips: ChartTip[];
}) {
  const api = useChartTip();
  const gid = useGradId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [cross, setCross] = useState<number | null>(null);
  const sp = sparkline(values);
  if (!sp) return null;
  const w = 300, h = 26, pad = 3;
  const p = pts(values, w, h, pad);

  const onMove = (e: PointerEvent) => {
    const i = snapIndex(e, svgRef.current, values.length, w, pad);
    if (i == null || !tips[i]) return;
    setCross(i);
    api.show(e, tips[i]);
  };

  return api.wrap(
    <svg
      ref={svgRef}
      className="mspark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={sp.area} className="ar" style={{ fill: `url(#${gid})`, stroke: "none" }} />
      <path d={sp.line} className="ln" stroke={color} />
      {cross != null ? (
        <circle cx={p[cross].x} cy={p[cross].y} r={2.5} fill={color}
          stroke="var(--page-bg)" strokeWidth={1} />
      ) : null}
      <rect
        x={0} y={0} width={w} height={h} fill="transparent"
        onPointerMove={onMove}
        onPointerLeave={() => { setCross(null); api.hide(); }}
      />
    </svg>,
  );
}

// ── Donut (Users who-breakdown) ─────────────────────────────────────────────

export function InteractiveDonut({
  segments, tips, gap = 4,
}: {
  segments: { value: number; color: string }[];
  tips: ChartTip[];
  gap?: number;
}) {
  const api = useChartTip();
  const [hot, setHot] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const arcs: { d: string; color: string; idx: number }[] = [];
  if (total > 0) {
    let acc = 0;
    segments.forEach((seg, idx) => {
      const v = Math.max(0, seg.value);
      if (v <= 0) return;
      const a0 = (acc / total) * 360;
      acc += v;
      const a1 = (acc / total) * 360;
      const span = a1 - a0;
      const g = Math.min(gap, span * 0.6);
      arcs.push({ d: arc(a0 + g / 2, a1 - g / 2), color: seg.color, idx });
    });
  }
  return api.wrap(
    <svg viewBox={RING_VIEWBOX}>
      <circle cx={50} cy={50} r={38} fill="none" stroke={TRACK} strokeWidth={11} />
      {arcs.map((a) => (
        <path
          key={a.idx}
          d={a.d}
          className="seg"
          pathLength={1}
          fill="none"
          stroke={a.color}
          strokeWidth={hot === a.idx ? 13 : 11}
          strokeLinecap="round"
          style={{ opacity: hot == null || hot === a.idx ? 1 : 0.45, transition: "opacity 120ms, stroke-width 120ms" }}
          onPointerEnter={(e) => { setHot(a.idx); if (tips[a.idx]) api.show(e, tips[a.idx]); }}
          onPointerMove={(e) => { if (tips[a.idx]) api.show(e, tips[a.idx]); }}
          onPointerLeave={() => { setHot(null); api.hide(); }}
        />
      ))}
    </svg>,
  );
}
