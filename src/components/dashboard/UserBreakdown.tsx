/**
 * Body slot for the "Usuarios" KPI card: shows new vs returning split as a
 * thin two-segment bar with absolute counts above and below.
 */
export function UserBreakdown({
  newUsers,
  returningUsers,
  newPct,
  returningPct,
  newLabel,
  returningLabel,
}: {
  newUsers: number;
  returningUsers: number;
  newPct: number; // 0..1
  returningPct: number; // 0..1
  newLabel: string;
  returningLabel: string;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--s-text-secondary)",
        }}
      >
        <span>{newLabel}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {newUsers.toLocaleString()} ({Math.round(newPct * 100)}%)
        </span>
      </div>
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--s-surface-alt)",
        }}
      >
        <div
          style={{
            width: `${newPct * 100}%`,
            background: "var(--scout-accent)",
          }}
        />
        <div
          style={{
            width: `${returningPct * 100}%`,
            background: "var(--s-success)",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--s-text-secondary)",
        }}
      >
        <span>{returningLabel}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {returningUsers.toLocaleString()} ({Math.round(returningPct * 100)}%)
        </span>
      </div>
    </div>
  );
}
