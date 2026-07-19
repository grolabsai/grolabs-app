/**
 * Server-rendered Signals pieces. The interactive charts (tooltips, crosshair)
 * live in signal-charts-client.tsx; this file keeps what needs no hydration —
 * the verdict-tile sparkline — plus re-exports shared helpers for the page.
 */

import { BAND, lin, pad, smoothPath, Grad } from "./signal-chart-util";

export { weekLabel } from "./signal-chart-util";

// Server components render once per request (no hydration), so a module
// counter is a safe unique-id source here.
let gradSeq = 0;

// ── Tiny state sparkline for the verdict tiles ──────────────────────────────

export function SignalSpark({
  values, cl, ucl, lcl, endColor,
}: {
  values: number[];
  cl: number | null; ucl: number | null; lcl: number | null;
  endColor: string;
}) {
  void cl; // centre hairline intentionally not drawn at sparkline scale
  if (values.length < 2) return null;
  const W = 300, H = 34, p = 4;
  const all = values.concat(ucl != null ? [ucl] : [], lcl != null ? [lcl] : []);
  const [d0, d1] = pad([Math.min(...all), Math.max(...all)], 0.15);
  const x = lin(0, values.length - 1, p, W - p);
  const y = lin(d0, d1, H - p, p);
  const line = smoothPath(values.map((_, i) => x(i)), values.map((v) => y(v)));
  const gid = `sig-grad-sp-${gradSeq++}`;
  return (
    <svg className="mspark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Normal-range band only — no centre hairline: at sparkline scale it reads
          as a second (baseline) series and fights the value line. The line itself
          wears the state color so it contrasts with the band. */}
      {ucl != null && lcl != null ? (
        <rect x={0} y={y(ucl)} width={W} height={Math.max(y(lcl) - y(ucl), 0)} fill={BAND} />
      ) : null}
      <Grad id={gid} color={endColor} />
      <path
        d={`${line} L ${(W - p).toFixed(1)} ${H} L ${p.toFixed(1)} ${H} Z`}
        fill={`url(#${gid})`}
      />
      <path d={line} fill="none" stroke={endColor} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.8} fill={endColor} />
    </svg>
  );
}
