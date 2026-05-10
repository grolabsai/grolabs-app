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
 * Sessions line chart with a 7-day rolling-average dotted overlay.
 * Used on the Traffic Detail page.
 */
export function SessionsLineChart({
  data,
  height = 240,
}: {
  data: {
    date: string;
    sessions: number;
    rolling_avg_sessions: number;
  }[];
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
            width={36}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              border: "0.5px solid var(--s-border-strong)",
              borderRadius: 6,
            }}
            labelStyle={{ color: "var(--s-text-tertiary)" }}
          />
          <Line
            type="monotone"
            dataKey="sessions"
            stroke="#378ADD"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="rolling_avg_sessions"
            stroke="#888780"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
