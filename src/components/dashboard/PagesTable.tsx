import { TrendPill } from "./TrendPill";

/**
 * Generic top-pages table (entry or exit). Renders inside its own surface
 * card. Columns: page, value, % of total or WoW delta.
 */
export function PagesTable({
  title,
  rows,
  valueLabel,
  totalLabel = "% del total",
  total,
  showDelta = true,
}: {
  title: string;
  rows: { page_path: string; value: number; delta_pct: number }[];
  valueLabel: string;
  totalLabel?: string;
  total?: number;
  showDelta?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--s-surface)",
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-lg)",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "0.5px solid var(--s-border)",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {title}
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ color: "var(--s-text-tertiary)", fontSize: 11, fontWeight: 500 }}>
            <th style={{ textAlign: "left", padding: "10px 20px", borderBottom: "0.5px solid var(--s-border)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Página
            </th>
            <th style={{ textAlign: "right", padding: "10px 20px", borderBottom: "0.5px solid var(--s-border)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {valueLabel}
            </th>
            <th style={{ textAlign: "right", padding: "10px 20px", borderBottom: "0.5px solid var(--s-border)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {showDelta ? "Cambio" : totalLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                style={{
                  textAlign: "center",
                  color: "var(--s-text-tertiary)",
                  padding: "20px",
                  fontSize: 12,
                }}
              >
                Sin datos
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const pct =
                !showDelta && total && total > 0
                  ? Math.round((r.value / total) * 100)
                  : null;
              return (
                <tr key={r.page_path}>
                  <td
                    style={{
                      padding: "10px 20px",
                      borderBottom: "0.5px solid var(--s-border)",
                      color: "var(--s-text)",
                      maxWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.page_path}
                  </td>
                  <td
                    style={{
                      padding: "10px 20px",
                      borderBottom: "0.5px solid var(--s-border)",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.value.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "10px 20px",
                      borderBottom: "0.5px solid var(--s-border)",
                      textAlign: "right",
                    }}
                  >
                    {showDelta ? (
                      <TrendPill value={r.delta_pct} unit="%" decimals={0} size={12} />
                    ) : pct !== null ? (
                      <span style={{ color: "var(--s-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        {pct}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
