/**
 * Pure SVG path builders for the insights dashboard.
 *
 * Ported from the design handoff's runtime chart engine, but deterministic and
 * server-renderable: every path is computed from real data passed in, so the
 * markup ships fully drawn (the reveal animation only toggles a CSS class).
 *
 * Donut / gauge geometry: 100×100 viewBox, centre (50,50), r 38.
 */

export const RING_VIEWBOX = "0 0 100 100";
const CX = 50;
const CY = 50;
const R = 38;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return {
    x: +(cx + r * Math.cos(a)).toFixed(2),
    y: +(cy + r * Math.sin(a)).toFixed(2),
  };
}

/** SVG arc path between two angles (degrees, clockwise from 12 o'clock). */
export function arc(
  a0: number,
  a1: number,
  cx = CX,
  cy = CY,
  r = R,
): string {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

/** Two-segment donut (whole split into A / B) with a small gap between arcs. */
export function donutSplit(frac: number, gap = 5): { a: string; b: string } {
  const f = Math.max(0, Math.min(1, frac));
  return {
    a: arc(gap / 2, 360 * f - gap / 2),
    b: arc(360 * f + gap / 2, 360 - gap / 2),
  };
}

/** Single-value donut: one arc from 12 o'clock spanning `frac` of the ring. */
export function donutSingle(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  // Clamp just under a full turn so the arc endpoints never coincide.
  const end = Math.min(359.999, 360 * f);
  return arc(0, end);
}

/** 270° gauge: track + value arc. start 135°, sweep 270°. */
export function gauge(value: number, max: number): { track: string; value: string } {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const start = 135;
  const sweep = 270;
  return {
    track: arc(start, start + sweep),
    value: arc(start, start + sweep * frac),
  };
}

// ── Line / area / sparkline ──────────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}

function coords(vals: number[], w: number, h: number, pad: number): Pt[] {
  const n = vals.length;
  if (n === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  return vals.map((v, i) => {
    const norm = span > 0 ? (v - min) / span : 0.5;
    return {
      x: +(pad + (n === 1 ? 0.5 : i / (n - 1)) * (w - 2 * pad)).toFixed(2),
      y: +(h - pad - norm * (h - 2 * pad)).toFixed(2),
    };
  });
}

function smooth(c: Pt[]): string {
  if (c.length < 2) {
    return c.length === 1 ? `M ${c[0].x} ${c[0].y}` : "";
  }
  let d = `M ${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)}`;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i];
    const b = c[i + 1];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)} ${mx.toFixed(1)} ${b.y.toFixed(
      1,
    )} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

export interface AreaChart {
  stroke: string;
  fill: string;
  end: Pt;
  width: number;
  height: number;
}

/** Smoothed area chart from a value series. Falls back gracefully when empty. */
export function areaChart(
  vals: number[],
  w = 320,
  h = 104,
  pad = 6,
): AreaChart | null {
  if (vals.length === 0) return null;
  const c = coords(vals, w, h, pad);
  const line = smooth(c);
  const fill = `${line} L ${w - pad} ${h} L ${pad} ${h} Z`;
  return { stroke: line, fill, end: c[c.length - 1], width: w, height: h };
}

/** Tiny sparkline (depth tile). */
export function sparkline(
  vals: number[],
  w = 300,
  h = 26,
  pad = 3,
): { line: string; area: string } | null {
  if (vals.length === 0) return null;
  const c = coords(vals, w, h, pad);
  const line = smooth(c);
  return { line, area: `${line} L ${w} ${h} L 0 ${h} Z` };
}
