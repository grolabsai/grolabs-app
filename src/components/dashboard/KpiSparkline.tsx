"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * Edge-to-edge sparkline used inside KpiCard.
 *
 * No axes, no tooltip, no labels — just the line. 2-3px stroke per design.
 * Renders empty when `data` has < 2 points (Recharts needs ≥2 to draw a line).
 */
export function KpiSparkline({
  data,
  color = "#378ADD",
  strokeWidth = 2.5,
  height = 60,
}: {
  data: { date: string; value: number }[];
  color?: string;
  strokeWidth?: number;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <div style={{ height }} />;
  }
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={strokeWidth}
            dot={false}
            isAnimationActive={false}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
