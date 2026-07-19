/**
 * Shared drawing vocabulary for the Signals charts — tokens and pure path
 * helpers used by both the server-rendered pieces (signal-charts.tsx) and the
 * interactive client pieces (signal-charts-client.tsx). No React state here.
 */

export const AX = "var(--t3)";
export const GRID = "rgba(255,255,255,0.06)";
export const CENTRE = "rgba(237,234,224,0.45)";
export const BAND = "rgba(255,255,255,0.05)";
export const LINE = "var(--blue)";
export const BAD = "var(--danger-solid)";
export const GOOD = "var(--success)";
export const MUTED = "rgba(237,234,224,0.35)";

/** Base SVG font size. */
export const F = 9.5;

export function lin(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function pad([lo, hi]: [number, number], frac = 0.12): [number, number] {
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * frac, hi + span * frac];
}

export function path(xs: number[], ys: number[]): string {
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i ? "L" : "M"}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`;
  return d;
}

/** Midpoint-cubic smoothing (same construction as geometry.ts `smooth`) —
 *  the curve still passes exactly through every data point. */
export function smoothPath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return "";
  if (xs.length === 1) return `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  let d = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const mx = ((xs[i] + xs[i + 1]) / 2).toFixed(1);
    d += ` C ${mx} ${ys[i].toFixed(1)} ${mx} ${ys[i + 1].toFixed(1)} ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

/** Sparse tick indexes: first, last, and ~n evenly between. */
export function tickIdx(len: number, n = 4): number[] {
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

/** Gradient area fade under a line (the Overview dashboard's chart language). */
export function Grad({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.22} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/** Prebuilt tooltip content — assembled on the server (i18n lives there),
 *  displayed by the client hover layer. */
export interface ChartTip {
  title: string;
  rows: { k: string; v: string }[];
}
