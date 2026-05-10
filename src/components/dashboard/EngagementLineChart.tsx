"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Engagement-rate line chart used on the Traffic Detail page.
 * Y-axis is rendered as percent (engagement_rate is stored 0..1).
 */
export function EngagementLineChart({
  data,
  height = 240,
}: {
  data: { date: string; engagement_rate: number }[];
  height?: number;
}) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--s-text-tertiary)",
          fontSize: 13,
        }}
      >
        No hay datos suficientes
      </div>
    );
  }

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--s-border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--s-text-tertiary)" }}
            tickFormatter={(d: string) => d.slice(5)}
            stroke="var(--s-border-strong)"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--s-text-tertiary)" }}
            stroke="var(--s-border-strong)"
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            width={42}
          />
          <Tooltip
            formatter={(v: unknown) =>
              typeof v === "number" ? `${(v * 100).toFixed(1)}%` : String(v)
            }
            contentStyle={{
              fontSize: 12,
              border: "0.5px solid var(--s-border-strong)",
              borderRadius: 6,
            }}
            labelStyle={{ color: "var(--s-text-tertiary)" }}
          />
          <Line
            type="monotone"
            dataKey="engagement_rate"
            stroke="#1D9E75"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
