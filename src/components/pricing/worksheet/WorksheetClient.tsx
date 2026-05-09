"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Sparkle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorksheetHeader } from "@/components/pricing/worksheet/WorksheetHeader";
import { WorksheetRow } from "@/components/pricing/worksheet/WorksheetRow";
import {
  bulkApproveItems,
  bulkDeleteItems,
  recomputeBatch,
  type BatchDetail,
  type BatchDetailItem,
} from "@/lib/actions/pricing";

/**
 * Top-level client for the worksheet. Owns:
 *   - Filter state (category / brand / status / "solo cambios")
 *   - Multi-row selection
 *   - Top banners (violation summary, stale config)
 *   - Bottom toolbar that appears when ≥1 rows selected
 *
 * Inline edits inside rows go through WorksheetRow's own server action
 * calls; the page is `dynamic = 'force-dynamic'` so router.refresh()
 * after each save reloads fresh state from the server.
 *
 * `editable` derives from batch.status — only `draft` can be modified.
 */
export function WorksheetClient({ batch }: { batch: BatchDetail }) {
  const t = useTranslations("pricing.batchDetail");
  const router = useRouter();

  const editable = batch.status === "draft";

  // Filter state -------------------------------------------------------------
  type StatusFilter = "all" | "neutral" | "warning" | "critical";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [onlyChanges, setOnlyChanges] = useState(false);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of batch.items) if (it.brand_name) set.add(it.brand_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [batch.items]);

  const filteredItems = useMemo(() => {
    return batch.items.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (brandFilter !== "all" && it.brand_name !== brandFilter) return false;
      if (onlyChanges) {
        // "Solo cambios" hides rows whose final_price equals current_price.
        // When current_price is null (no synced history yet) we treat the
        // row as a change so the filter behaves intuitively for first-time
        // batches.
        if (
          it.current_price !== null &&
          it.final_price !== null &&
          Math.abs(it.current_price - it.final_price) < 0.005
        ) {
          return false;
        }
      }
      return true;
    });
  }, [batch.items, statusFilter, brandFilter, onlyChanges]);

  // Selection ----------------------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allFilteredIds = useMemo(
    () => new Set(filteredItems.map((it) => it.price_batch_item_id)),
    [filteredItems],
  );
  const allFilteredSelected =
    filteredItems.length > 0 &&
    filteredItems.every((it) => selected.has(it.price_batch_item_id));

  function toggleAllFiltered(check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (check) {
        for (const id of allFilteredIds) next.add(id);
      } else {
        for (const id of allFilteredIds) next.delete(id);
      }
      return next;
    });
  }

  function toggleOne(id: number, check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (check) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Bulk actions -------------------------------------------------------------
  const [bulkPending, startBulk] = useTransition();

  function onBulkApprove() {
    const ids = Array.from(selected);
    startBulk(async () => {
      const res = await bulkApproveItems(ids);
      if (!res.ok) {
        toast.error(t("toast.bulkApproveError"), { description: res.error });
        return;
      }
      toast.success(t("toast.bulkApproved", { n: ids.length }));
      setSelected(new Set());
      router.refresh();
    });
  }

  function onBulkDelete() {
    const ids = Array.from(selected);
    if (!window.confirm(t("toast.bulkDeleteConfirm", { n: ids.length }))) {
      return;
    }
    startBulk(async () => {
      const res = await bulkDeleteItems(ids);
      if (!res.ok) {
        toast.error(t("toast.bulkDeleteError"), { description: res.error });
        return;
      }
      toast.success(t("toast.bulkDeleted", { n: ids.length }));
      setSelected(new Set());
      router.refresh();
    });
  }

  // Stale-config recompute (banner) -----------------------------------------
  const [recomputingStale, startRecomputeStale] = useTransition();
  function onRecomputeFromBanner() {
    startRecomputeStale(async () => {
      const res = await recomputeBatch(batch.price_batch_id);
      if (!res.ok) {
        toast.error(t("toast.recomputeError"), { description: res.error });
        return;
      }
      toast.success(t("toast.recomputed"));
      router.refresh();
    });
  }

  return (
    <>
      <WorksheetHeader batch={batch} onMutated={() => router.refresh()} />

      {/* Stale-config banner -------------------------------------------- */}
      {batch.config_stale && batch.status === "draft" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            marginBottom: 16,
            background: "#E6F1FB",
            borderLeft: "3px solid var(--scout-accent)",
            borderRadius: "var(--s-radius-md)",
            fontSize: 13,
            color: "var(--scout-accent-800)",
          }}
        >
          <Icon icon={Sparkle} size={16} strokeWidth={2} />
          <span style={{ flex: 1 }}>{t("staleBanner")}</span>
          <Button
            type="button"
            size="sm"
            onClick={onRecomputeFromBanner}
            disabled={recomputingStale}
          >
            <Icon icon={RefreshCw} size={12} strokeWidth={2} />
            <span style={{ marginLeft: 4 }}>
              {recomputingStale
                ? t("buttons.recomputing")
                : t("buttons.recompute")}
            </span>
          </Button>
        </div>
      ) : null}

      {/* Violation summary cards ---------------------------------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <CountCard
          icon={CheckCircle2}
          label={t("counts.neutral")}
          value={batch.neutral_count}
          tone="neutral"
        />
        <CountCard
          icon={AlertTriangle}
          label={t("counts.warning")}
          value={batch.warning_count}
          tone="warn"
        />
        <CountCard
          icon={AlertCircle}
          label={t("counts.critical")}
          value={batch.critical_count}
          tone="critical"
        />
      </div>

      {/* Filter bar ------------------------------------------------------ */}
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
        <FilterField label={t("filters.status")}>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger style={{ height: 32, minWidth: 140 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.statusOptions.all")}</SelectItem>
              <SelectItem value="neutral">
                {t("filters.statusOptions.neutral")}
              </SelectItem>
              <SelectItem value="warning">
                {t("filters.statusOptions.warning")}
              </SelectItem>
              <SelectItem value="critical">
                {t("filters.statusOptions.critical")}
              </SelectItem>
            </SelectContent>
          </Select>
        </FilterField>

        {brandOptions.length > 0 ? (
          <FilterField label={t("filters.brand")}>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger style={{ height: 32, minWidth: 160 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.brandAll")}</SelectItem>
                {brandOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        ) : null}

        <div style={{ flex: 1 }} />

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--s-text-secondary)",
            cursor: "pointer",
          }}
        >
          <Switch checked={onlyChanges} onCheckedChange={setOnlyChanges} />
          {t("filters.onlyChanges")}
        </label>

        <span
          style={{
            fontSize: 12,
            color: "var(--s-text-tertiary)",
          }}
        >
          {t("filters.shown", {
            shown: filteredItems.length,
            total: batch.items.length,
          })}
        </span>
      </div>

      {/* Items table ---------------------------------------------------- */}
      <section
        style={{
          background: "var(--s-surface)",
          border: "1px solid var(--s-border)",
          borderRadius: "var(--s-radius-lg)",
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
              <Th align="left" width={32}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={(e) => toggleAllFiltered(e.target.checked)}
                  aria-label={t("selectAll")}
                  disabled={!editable || filteredItems.length === 0}
                />
              </Th>
              <Th>{t("cols.product")}</Th>
              <Th align="right">{t("cols.cost")}</Th>
              <Th align="right">{t("cols.currentPrice")}</Th>
              <Th align="right">{t("cols.charmPrice")}</Th>
              <Th align="right">{t("cols.finalPrice")}</Th>
              <Th align="right">{t("cols.margin")}</Th>
              <Th>{t("cols.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((it) => (
              <WorksheetRow
                key={it.price_batch_item_id}
                item={it}
                selected={selected.has(it.price_batch_item_id)}
                onToggleSelect={(c) => toggleOne(it.price_batch_item_id, c)}
                editable={editable}
              />
            ))}
          </tbody>
        </table>
        {filteredItems.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--s-text-tertiary)",
            }}
          >
            {batch.items.length === 0
              ? t("emptyItems")
              : t("emptyAfterFilters")}
          </div>
        ) : null}
      </section>

      {/* Bulk actions toolbar ------------------------------------------- */}
      {selected.size > 0 && editable ? (
        <BulkBar
          count={selected.size}
          onApprove={onBulkApprove}
          onDelete={onBulkDelete}
          onClear={() => setSelected(new Set())}
          pending={bulkPending}
        />
      ) : null}
    </>
  );
}

// =============================================================================
// Sub-pieces
// =============================================================================

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

function CountCard({
  icon: IconCmp,
  label,
  value,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number;
  tone: "neutral" | "warn" | "critical";
}) {
  const palette = {
    neutral: { fg: "var(--s-success-text)", bg: "var(--s-success-bg)" },
    warn: { fg: "#B45309", bg: "#FFF7ED" },
    critical: { fg: "var(--s-danger-text)", bg: "var(--s-danger-bg)" },
  }[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: palette.bg,
        borderRadius: "var(--s-radius-md)",
      }}
    >
      <Icon icon={IconCmp} size={20} strokeWidth={2} />
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: palette.fg,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: palette.fg,
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function BulkBar({
  count,
  onApprove,
  onDelete,
  onClear,
  pending,
}: {
  count: number;
  onApprove: () => void;
  onDelete: () => void;
  onClear: () => void;
  pending: boolean;
}) {
  const t = useTranslations("pricing.batchDetail");
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--s-text)",
        color: "white",
        borderRadius: "var(--s-radius-lg)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.18)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {t("bulk.selected", { n: count })}
      </span>
      <div
        style={{
          width: 1,
          height: 18,
          background: "rgba(255, 255, 255, 0.2)",
        }}
      />
      <button
        type="button"
        onClick={onApprove}
        disabled={pending}
        style={bulkBtnStyle}
      >
        <Icon icon={CheckCircle2} size={14} strokeWidth={2} />
        <span style={{ marginLeft: 4 }}>{t("bulk.approve")}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        style={{ ...bulkBtnStyle, color: "#FCA5A5" }}
      >
        <Icon icon={Trash2} size={14} strokeWidth={2} />
        <span style={{ marginLeft: 4 }}>{t("bulk.delete")}</span>
      </button>
      <div
        style={{
          width: 1,
          height: 18,
          background: "rgba(255, 255, 255, 0.2)",
        }}
      />
      <button
        type="button"
        onClick={onClear}
        style={{ ...bulkBtnStyle, color: "rgba(255, 255, 255, 0.7)" }}
      >
        {t("bulk.clear")}
      </button>
    </div>
  );
}

const bulkBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 500,
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  color: "white",
  borderRadius: "var(--s-radius-sm)",
  cursor: "pointer",
};
