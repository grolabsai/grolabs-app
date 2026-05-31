"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, AlertTriangle, AlertCircle } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkApproveItems, type AuthQueueRow } from "@/lib/actions/pricing";
import { formatGTQ, formatRelative } from "@/lib/format";

/**
 * Cross-batch authorisation queue. Replaces the placeholder card on
 * /pricing/violations with a real table of every warning + critical row
 * across non-synced batches.
 *
 * Row actions:
 *   - Aprobar (✓): force this row to neutral via bulkApproveItems([id]).
 *     A 'manually_approved' tag is appended to status_reasons by the
 *     server action so the audit context survives.
 *   - Ver en lote (↗): jumps to /pricing/changes/[batch_id] where the
 *     full row context is editable.
 *
 * Filters: severity (all/warning/critical) + batch dropdown built from
 * the row set itself.
 */
export function AuthQueueCard({ initial }: { initial: AuthQueueRow[] }) {
  const t = useTranslations("pricing.authQueue");
  const tReason = useTranslations("pricing.reasonCodes");
  const router = useRouter();

  const [severity, setSeverity] = useState<"all" | "warning" | "critical">(
    "all",
  );
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [approving, startApprove] = useTransition();

  const batchOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of initial) map.set(r.price_batch_id, r.batch_name);
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "es"),
    );
  }, [initial]);

  const filtered = useMemo(() => {
    return initial.filter((r) => {
      if (severity !== "all" && r.status !== severity) return false;
      if (batchFilter !== "all" && String(r.price_batch_id) !== batchFilter) {
        return false;
      }
      return true;
    });
  }, [initial, severity, batchFilter]);

  function onApprove(itemId: number) {
    startApprove(async () => {
      const res = await bulkApproveItems([itemId]);
      if (!res.ok) {
        toast.error(t("toast.approveError"), { description: res.error });
        return;
      }
      toast.success(t("toast.approved"));
      router.refresh();
    });
  }

  return (
    <section className="pricing-section">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--s-text)",
              marginBottom: 4,
            }}
          >
            {t("title")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--s-text-tertiary)" }}>
            {t("subtitle")}
          </p>
        </div>
      </header>

      {initial.length === 0 ? (
        <div
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 13,
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("empty")}
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              marginBottom: 12,
              background: "var(--s-surface-alt)",
              border: "1px solid var(--s-border)",
              borderRadius: "var(--s-radius-md)",
            }}
          >
            <FilterField label={t("filters.severity")}>
              <Select
                value={severity}
                onValueChange={(v) =>
                  setSeverity(v as "all" | "warning" | "critical")
                }
              >
                <SelectTrigger style={{ height: 32, minWidth: 140 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("filters.severityOptions.all")}
                  </SelectItem>
                  <SelectItem value="critical">
                    {t("filters.severityOptions.critical")}
                  </SelectItem>
                  <SelectItem value="warning">
                    {t("filters.severityOptions.warning")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            {batchOptions.length > 1 ? (
              <FilterField label={t("filters.batch")}>
                <Select value={batchFilter} onValueChange={setBatchFilter}>
                  <SelectTrigger style={{ height: 32, minWidth: 200 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("filters.batchAll")}
                    </SelectItem>
                    {batchOptions.map(([id, name]) => (
                      <SelectItem key={id} value={String(id)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            ) : null}

            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 12,
                color: "var(--s-text-tertiary)",
              }}
            >
              {t("shown", { shown: filtered.length, total: initial.length })}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div
              style={{
                padding: "24px 0",
                textAlign: "center",
                fontSize: 13,
                color: "var(--s-text-tertiary)",
              }}
            >
              {t("emptyAfterFilters")}
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--s-border)",
                borderRadius: "var(--s-radius-md)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--s-surface-alt)",
                      borderBottom: "1px solid var(--s-border)",
                    }}
                  >
                    <Th width={32}>{" "}</Th>
                    <Th>{t("cols.product")}</Th>
                    <Th>{t("cols.batch")}</Th>
                    <Th>{t("cols.reasons")}</Th>
                    <Th align="right">{t("cols.currentPrice")}</Th>
                    <Th align="right">{t("cols.finalPrice")}</Th>
                    <Th align="right">{t("cols.margin")}</Th>
                    <Th>{" "}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.price_batch_item_id}
                      style={{ borderBottom: "1px solid var(--s-border)" }}
                    >
                      <Td>
                        <SeverityDot status={r.status} />
                      </Td>
                      <Td>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--s-text)",
                          }}
                        >
                          {r.variant_label}
                        </div>
                        {r.brand_name ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--s-text-tertiary)",
                            }}
                          >
                            {r.brand_name}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <Link
                          href={`/pricing/changes/${r.price_batch_id}`}
                          style={{
                            fontSize: 12,
                            color: "var(--rre-accent-800)",
                            textDecoration: "none",
                          }}
                        >
                          {r.batch_name}
                        </Link>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--s-text-tertiary)",
                          }}
                        >
                          {formatRelative(r.updated_at)}
                        </div>
                      </Td>
                      <Td>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                          }}
                        >
                          {r.status_reasons.length === 0 ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--s-text-tertiary)",
                              }}
                            >
                              —
                            </span>
                          ) : (
                            r.status_reasons.map((code) => (
                              <ReasonChip
                                key={code}
                                code={code}
                                label={translateReason(code, tReason)}
                              />
                            ))
                          )}
                        </div>
                      </Td>
                      <Td align="right">
                        <Mono color="muted">{formatGTQ(r.current_price)}</Mono>
                      </Td>
                      <Td align="right">
                        <Mono>{formatGTQ(r.final_price)}</Mono>
                      </Td>
                      <Td align="right">
                        <Mono>
                          {r.margin_percent === null
                            ? "—"
                            : `${r.margin_percent.toFixed(1)}%`}
                        </Mono>
                      </Td>
                      <Td align="right">
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onApprove(r.price_batch_item_id)}
                            disabled={approving}
                            aria-label={t("buttons.approve")}
                            title={t("buttons.approve")}
                            style={iconBtnStyle}
                          >
                            <Icon
                              icon={CheckCircle2}
                              size={14}
                              strokeWidth={2}
                            />
                          </button>
                          <Link
                            href={`/pricing/changes/${r.price_batch_id}`}
                            aria-label={t("buttons.openBatch")}
                            title={t("buttons.openBatch")}
                            style={{
                              ...iconBtnStyle,
                              textDecoration: "none",
                            }}
                          >
                            <Icon
                              icon={ExternalLink}
                              size={14}
                              strokeWidth={1.75}
                            />
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

const KNOWN_REASON_CODES = new Set([
  "below_map",
  "above_max",
  "low_margin",
  "under_target",
  "price_change_exceeds_threshold",
  "manually_approved",
]);

function translateReason(code: string, t: (k: string) => string): string {
  return KNOWN_REASON_CODES.has(code) ? t(code) : code;
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: "var(--s-text-tertiary)",
      }}
    >
      <span style={{ fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function SeverityDot({ status }: { status: "warning" | "critical" }) {
  return (
    <span
      title={status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: "50%",
        background:
          status === "critical" ? "var(--s-danger-bg)" : "#FFF7ED",
        color:
          status === "critical" ? "var(--s-danger-text)" : "#B45309",
      }}
    >
      <Icon
        icon={status === "critical" ? AlertCircle : AlertTriangle}
        size={14}
        strokeWidth={2}
      />
    </span>
  );
}

function ReasonChip({ code, label }: { code: string; label: string }) {
  // Critical reason codes get a red tint; warnings get amber; the rest
  // (e.g. manually_approved) read as informational.
  const palette = (() => {
    if (code === "below_map" || code === "above_max" || code === "low_margin") {
      return { bg: "var(--s-danger-bg)", fg: "var(--s-danger-text)" };
    }
    if (
      code === "under_target" ||
      code === "price_change_exceeds_threshold"
    ) {
      return { bg: "#FFF7ED", fg: "#B45309" };
    }
    return { bg: "var(--s-surface-alt)", fg: "var(--s-text-secondary)" };
  })();
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {label}
    </span>
  );
}

function Th({
  children,
  align = "left",
  width,
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  width?: number;
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontWeight: 500,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--s-text-tertiary)",
        width: width !== undefined ? `${width}px` : undefined,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px 12px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function Mono({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "default" | "muted";
}) {
  return (
    <span
      style={{
        fontFamily: "var(--s-font-mono)",
        fontSize: 12,
        color: color === "muted" ? "var(--s-text-tertiary)" : "var(--s-text)",
      }}
    >
      {children}
    </span>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "none",
  background: "transparent",
  color: "var(--s-text-tertiary)",
  borderRadius: "var(--s-radius-md)",
  cursor: "pointer",
};
