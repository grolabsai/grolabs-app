"use client";

import { useTranslations } from "next-intl";
import { useFieldHintState } from "@/components/shell/FieldHintContext";

/**
 * Client-side comparison table for the page detail. Each cell is a
 * button that opens a hint card in the right-side agent panel showing
 * the full diagnostic detail (status, score, notes, evidence). This
 * replaces the dead-end "ERROR" label with a clickable affordance that
 * tells the user *why* the check errored.
 */

export type ComparisonCell = {
  score: number | null;
  status: "pass" | "fail" | "partial" | "na" | "error" | string;
  notes: string | null;
  evidence: Record<string, unknown> | null;
};

export type ComparisonRow = {
  check_id: number;
  check_name: string;
  check_code: string;
  latest: ComparisonCell | null;
  previous: ComparisonCell | null;
};

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const t = useTranslations("prospects.page");

  return (
    <div
      style={{
        border: "0.5px solid var(--s-border)",
        borderRadius: "var(--s-radius-md)",
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--s-surface-alt)" }}>
            <Th>{t("compareTable.check")}</Th>
            <Th>{t("compareTable.previous")}</Th>
            <Th>{t("compareTable.latest")}</Th>
            <Th>{t("compareTable.delta")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.check_id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  const ps = row.previous?.score ?? null;
  const ls = row.latest?.score ?? null;
  const delta = ps != null && ls != null ? ls - ps : null;
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  const color =
    delta == null
      ? "var(--s-text-tertiary)"
      : delta > 0
        ? "var(--s-success)"
        : delta < 0
          ? "var(--s-danger)"
          : "var(--s-text-secondary)";
  return (
    <tr style={{ borderTop: "1px solid var(--s-border)" }}>
      <td style={{ padding: "8px 12px", fontSize: 12 }}>
        <div style={{ fontWeight: 500 }}>{row.check_name}</div>
        <div
          style={{
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            fontFamily: "var(--s-font-mono)",
          }}
        >
          {row.check_code}
        </div>
      </td>
      <td style={cellStyle()}>
        <ScoreCell
          cell={row.previous}
          checkName={row.check_name}
          checkCode={row.check_code}
          when="previous"
        />
      </td>
      <td style={cellStyle()}>
        <ScoreCell
          cell={row.latest}
          checkName={row.check_name}
          checkCode={row.check_code}
          when="latest"
        />
      </td>
      <td
        style={{
          ...cellStyle(),
          color,
          fontFamily: "var(--s-font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {delta != null ? sign(delta) : ""}
      </td>
    </tr>
  );
}

function ScoreCell({
  cell,
  checkName,
  checkCode,
  when,
}: {
  cell: ComparisonCell | null;
  checkName: string;
  checkCode: string;
  when: "latest" | "previous";
}) {
  const t = useTranslations("prospects.page");
  const { setHint } = useFieldHintState();
  if (!cell) return null;

  const color: Record<string, string> = {
    pass: "var(--s-success)",
    partial: "var(--s-warning-text)",
    fail: "var(--s-danger)",
    na: "var(--s-text-tertiary)",
    error: "var(--s-danger)",
  };
  const statusColor = color[cell.status] ?? "var(--s-text-tertiary)";
  const hasDetail =
    cell.notes != null ||
    (cell.evidence != null && Object.keys(cell.evidence).length > 0) ||
    cell.status === "error" ||
    cell.status === "na";

  const onClick = hasDetail
    ? () =>
        setHint({
          label: `${checkName} · ${when === "latest" ? t("latestScan") : t("previousScan")}`,
          body: formatDetail(cell, t),
        })
    : undefined;

  const content = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: statusColor,
          minWidth: 50,
        }}
      >
        {cell.status}
      </span>
      <span
        style={{
          fontFamily: "var(--s-font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {cell.score ?? ""}
      </span>
      {hasDetail && (
        <span
          aria-hidden
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--s-text-tertiary)",
            lineHeight: 1,
          }}
        >
          ⓘ
        </span>
      )}
    </div>
  );

  if (!onClick) return content;
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("revealDetail")}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
        width: "100%",
      }}
    >
      {content}
    </button>
  );
}

function formatDetail(
  cell: ComparisonCell,
  t: ReturnType<typeof useTranslations>,
): string {
  const lines: string[] = [];
  lines.push(`${t("detail.status")}: ${cell.status.toUpperCase()}`);
  if (cell.score != null) lines.push(`${t("detail.score")}: ${cell.score} / 100`);

  // Top-of-card guidance for ERROR / NA — explains *what the user can
  // actually do* about it. Keyed off the most common evidence shapes
  // the scorers produce.
  const guidance = guidanceFor(cell, t);
  if (guidance) {
    lines.push("");
    lines.push(guidance);
  }

  if (cell.notes) {
    lines.push("");
    lines.push(`${t("detail.notes")}:`);
    lines.push(cell.notes);
  }

  if (cell.evidence && Object.keys(cell.evidence).length > 0) {
    lines.push("");
    lines.push(`${t("detail.evidence")}:`);
    for (const [k, v] of Object.entries(cell.evidence).slice(0, 8)) {
      lines.push(`  ${k}: ${formatValue(v)}`);
    }
  }

  return lines.join("\n");
}

function guidanceFor(
  cell: ComparisonCell,
  t: ReturnType<typeof useTranslations>,
): string | null {
  const ev = (cell.evidence ?? {}) as Record<string, unknown>;
  if (cell.status === "error") {
    if (typeof ev.fetch_error === "string" && ev.fetch_error.length > 0) {
      return t("detail.guidance.fetchError");
    }
    if (ev.browser_probe_disabled === true) {
      return t("detail.guidance.browserDisabled");
    }
    if (ev.psi_disabled === true || ev.cwv_disabled === true) {
      return t("detail.guidance.psiDisabled");
    }
    if (typeof ev.psi_error === "string") {
      return t("detail.guidance.psiError");
    }
    if (typeof ev.glpim_error === "string") {
      return t("detail.guidance.glpimError");
    }
    return t("detail.guidance.genericError");
  }
  if (cell.status === "na") {
    return t("detail.guidance.notApplicable");
  }
  return null;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 200 ? j.slice(0, 200) + "…" : j;
  } catch {
    return String(v);
  }
}

function cellStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--s-text)",
  };
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: "left",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--s-text-tertiary)",
        borderBottom: "0.5px solid var(--s-border)",
      }}
    >
      {children}
    </th>
  );
}
