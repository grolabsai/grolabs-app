import { Bell } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { TrendPill } from "./TrendPill";
import { KpiSparkline } from "./KpiSparkline";

/**
 * KPI card used in the Resumen tab grid.
 *
 * Variants:
 *   - "ok"          — normal state (green/blue sparkline)
 *   - "firing"      — threshold breached (red sparkline + badge)
 *   - "unavailable" — designed visual frame, no real data yet
 *
 * `invertedTrend`: pass true when going-down is good (e.g., no-results).
 *
 * Cards can be wrapped in a Link for click-through; the card itself uses the
 * hover-border-accent pattern from the mockup.
 */
export interface KpiCardProps {
  label: string;
  meta?: string;
  thresholdLabel?: string;
  status?: "ok" | "firing" | "unavailable";
  alertCount?: number;
  // value + trend (when status !== "unavailable")
  value?: string;
  trend?: {
    value: number;
    unit?: "%" | "pp" | "" | string;
    decimals?: number;
    invertedGood?: boolean;
  };
  spark?: { date: string; value: number }[];
  sparkColor?: string;
  // Optional custom body, replaces the value+trend area (e.g., Usuarios w/ breakdown)
  bodySlot?: React.ReactNode;
  // Footer slot replaces the sparkline (e.g., user breakdown bar)
  footerSlot?: React.ReactNode;
}

export function KpiCard(props: KpiCardProps) {
  const {
    label,
    meta,
    thresholdLabel,
    status = "ok",
    alertCount = 0,
    value,
    trend,
    spark,
    sparkColor,
    bodySlot,
    footerSlot,
  } = props;

  const isUnavailable = status === "unavailable";
  const inferredColor =
    sparkColor ??
    (status === "firing" ? "var(--s-danger)" : "var(--scout-accent)");

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        minHeight: 220,
        opacity: isUnavailable ? 0.85 : 1,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 500,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{label}</span>
        {alertCount > 0 ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 16,
              height: 16,
              padding: "0 5px",
              borderRadius: 999,
              background: "var(--s-danger)",
              color: "white",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0,
            }}
          >
            {alertCount}
          </span>
        ) : null}
      </div>

      {bodySlot ?? (
        <>
          {isUnavailable ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  color: "var(--s-text-secondary)",
                  fontWeight: 500,
                }}
              >
                Datos no disponibles aún
              </div>
              <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                Requiere instrumentación de búsqueda
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  color: "var(--s-text)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {value ?? "—"}
              </div>
              {trend ? (
                <TrendPill
                  value={trend.value}
                  unit={trend.unit}
                  decimals={trend.decimals}
                  invertedGood={trend.invertedGood}
                />
              ) : null}
            </div>
          )}
          {meta ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                marginBottom: 0,
              }}
            >
              {meta}
            </div>
          ) : null}
        </>
      )}

      {footerSlot ? (
        footerSlot
      ) : !isUnavailable && spark && spark.length > 1 ? (
        <div
          style={{
            marginTop: "auto",
            paddingTop: 16,
            marginLeft: -20,
            marginRight: -20,
            marginBottom: -20,
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: 0,
          }}
        >
          <KpiSparkline data={spark} color={inferredColor} />
        </div>
      ) : (
        <div style={{ flex: 1 }} />
      )}

      {thresholdLabel ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--s-text-tertiary)",
            paddingTop: 12,
            marginTop: footerSlot || isUnavailable ? "auto" : 0,
            borderTop: "0.5px solid var(--s-border)",
            // Counter the negative margins above when sparkline is present
            marginLeft: !footerSlot && !isUnavailable && spark ? -20 : 0,
            marginRight: !footerSlot && !isUnavailable && spark ? -20 : 0,
            paddingLeft: !footerSlot && !isUnavailable && spark ? 20 : 0,
            paddingRight: !footerSlot && !isUnavailable && spark ? 20 : 0,
          }}
        >
          <Icon icon={Bell} size={11} />
          <span>{thresholdLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
