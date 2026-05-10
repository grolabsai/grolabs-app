import { Link } from "@/i18n/routing";
import { Icon } from "@/components/ui/icon";
import { ChevronRight } from "lucide-react";

const PALETTE = ["#378ADD", "#1D9E75", "#D97706", "#888780", "#A32D2D"];

/**
 * Full-width horizontal stacked bar with legend. Used on the Resumen tab and
 * the Traffic Detail page.
 */
export function TrafficSourcesBar({
  title,
  segments,
  total,
  detailHref,
  detailLabel,
}: {
  title: string;
  segments: { channel: string; sessions: number; share: number }[];
  total: number;
  detailHref?: string;
  detailLabel?: string;
}) {
  if (segments.length === 0) {
    return (
      <div
        style={{
          background: "var(--s-surface)",
          border: "0.5px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
          No hay datos de tráfico para este período.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        {detailHref ? (
          <Link
            href={detailHref}
            style={{
              fontSize: 12,
              color: "var(--scout-accent)",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              textDecoration: "none",
            }}
          >
            {detailLabel}
            <Icon icon={ChevronRight} size={14} />
          </Link>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          height: 32,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--s-surface-alt)",
          marginBottom: 16,
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={seg.channel}
            style={{
              width: `${seg.share * 100}%`,
              background: PALETTE[i % PALETTE.length],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 11,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`${seg.channel} · ${(seg.share * 100).toFixed(0)}%`}
          >
            {seg.share >= 0.1
              ? `${seg.channel} · ${Math.round(seg.share * 100)}%`
              : null}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={seg.channel}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: PALETTE[i % PALETTE.length],
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text)",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {seg.channel}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--s-text-tertiary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {seg.sessions.toLocaleString()} · {Math.round(seg.share * 100)}%
            </div>
          </div>
        ))}
      </div>

      {total > 0 ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "var(--s-text-tertiary)",
          }}
        >
          Total: {total.toLocaleString()} sesiones
        </div>
      ) : null}
    </div>
  );
}
