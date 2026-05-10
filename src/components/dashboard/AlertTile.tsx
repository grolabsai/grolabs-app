import { KpiSparkline } from "./KpiSparkline";

/**
 * Wide tile used on the Traffic Detail page header. Shows current value,
 * a tiny inline sparkline, and two comparison rows (vs ayer / vs 7d atrás).
 *
 * Status drives the colored dot + sparkline tint:
 *   - "ok"       — green
 *   - "warning"  — amber
 *   - "critical" — red
 */
export function AlertTile({
  label,
  value,
  status = "ok",
  spark,
  comparisons,
}: {
  label: string;
  value: string;
  status?: "ok" | "warning" | "critical";
  spark?: { date: string; value: number }[];
  comparisons?: Array<{
    label: string;
    value: string;
    tone: "positive" | "negative" | "neutral";
  }>;
}) {
  const dotColor =
    status === "critical"
      ? "var(--s-danger)"
      : status === "warning"
        ? "#D97706"
        : "var(--s-success)";

  const sparkColor =
    status === "critical"
      ? "rgba(163, 45, 45, 0.65)"
      : status === "warning"
        ? "rgba(217, 119, 6, 0.65)"
        : "rgba(29, 158, 117, 0.65)";

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderLeft: `3px solid ${dotColor}`,
        borderRadius: "var(--s-radius-lg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: dotColor,
          }}
        />
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: "var(--s-text)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {spark && spark.length > 1 ? (
        <div style={{ height: 24 }}>
          <KpiSparkline data={spark} color={sparkColor} strokeWidth={1.5} height={24} />
        </div>
      ) : null}
      {comparisons && comparisons.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 4,
          }}
        >
          {comparisons.map((c, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                {c.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  color:
                    c.tone === "positive"
                      ? "var(--s-success)"
                      : c.tone === "negative"
                        ? "var(--s-danger)"
                        : "var(--s-text-tertiary)",
                }}
              >
                {c.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
