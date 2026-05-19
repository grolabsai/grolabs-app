"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import {
  CheckCircle2,
  Clock,
  Minus,
  History,
  Settings2,
  RefreshCw,
} from "lucide-react";

import { Link } from "@/i18n/routing";
import { useActivityStream } from "@/lib/activity-stream";
import {
  syncProductsToAlgolia,
  syncProductsToMeilisearch,
  syncProductsToWordPress,
} from "@/lib/actions/sync";
import { ALGOLIA_FIELD_MAPPINGS } from "@/lib/sync/algolia-mapping";
import { WOOCOMMERCE_FIELD_MAPPINGS } from "@/lib/sync/woocommerce-mapping";
import type { Platform, SyncStatus } from "@/lib/sync/sync-status";

// ─── Types passed from the server component ───────────────────────────────

export type ProductRow = {
  productId: number;
  productName: string;
  slug: string;
  isActive: boolean;
  /** Max(product, variants, pricing).updated_at — drives "pending" derivation */
  effectiveUpdatedAt: string;
  /** Number of variants with a SKU. Variants without a SKU are skipped on push. */
  variantSkuCount: number;
  algolia: { status: SyncStatus; lastSyncedAt: string | null };
  woocommerce: { status: SyncStatus; lastSyncedAt: string | null };
  meilisearch: {
    status: SyncStatus;
    lastSyncedAt: string | null;
    /** Latest backend_operation diagnostic for this product (failed task
     * error, or "skipped: no WooCommerce id yet"). Shown on hover. */
    note?: string | null;
  };
};

export type SyncLogEntry = {
  id: number;
  platform: Platform;
  startedAt: string;
  endedAt: string | null;
  productsCount: number;
  succeededCount: number;
  failedCount: number;
  status: "running" | "success" | "partial" | "error";
  errorMessage: string | null;
};

type Filter =
  | "all"
  | "algolia-pending"
  | "wordpress-pending"
  | "meilisearch-pending"
  | "any-pending";

type Props = {
  rows: ProductRow[];
  logEntries: SyncLogEntry[];
  algoliaConfigured: boolean;
  woocommerceConfigured: boolean;
};

// ─── Component ─────────────────────────────────────────────────────────────

export function SyncManager({
  rows,
  logEntries,
  algoliaConfigured,
  woocommerceConfigured,
}: Props) {
  const t = useTranslations("sync");
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [showLog, setShowLog] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [syncingPlatform, setSyncingPlatform] = useState<Platform | null>(null);
  const { reportError, reportWarning } = useActivityStream();

  // ── Counts for the header badges ─────────────────────────────────────────
  const counts = useMemo(() => {
    const c = {
      algolia: { synced: 0, pending: 0 },
      woocommerce: { synced: 0, pending: 0 },
      meilisearch: { synced: 0, pending: 0 },
    };
    for (const r of rows) {
      if (r.algolia.status === "synced") c.algolia.synced++;
      else c.algolia.pending++;
      if (r.woocommerce.status === "synced") c.woocommerce.synced++;
      else c.woocommerce.pending++;
      if (r.meilisearch.status === "synced") c.meilisearch.synced++;
      else c.meilisearch.pending++;
    }
    return c;
  }, [rows]);

  // ── Filtered rows ───────────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "algolia-pending") return rows.filter((r) => r.algolia.status !== "synced");
    if (filter === "wordpress-pending") return rows.filter((r) => r.woocommerce.status !== "synced");
    if (filter === "meilisearch-pending")
      return rows.filter((r) => r.meilisearch.status !== "synced");
    if (filter === "any-pending")
      return rows.filter(
        (r) =>
          r.algolia.status !== "synced" ||
          r.woocommerce.status !== "synced" ||
          r.meilisearch.status !== "synced",
      );
    return rows;
  }, [rows, filter]);

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));
  const selectedCount = selectedIds.length;

  function toggleAll() {
    const allSelected = visible.length > 0 && visible.every((r) => selected[r.productId]);
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<number, boolean> = {};
      for (const r of visible) next[r.productId] = true;
      setSelected(next);
    }
  }

  function toggle(id: number) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  function runSync(platform: Platform) {
    if (selectedIds.length === 0) return;
    setSyncingPlatform(platform);
    startTransition(async () => {
      const r =
        platform === "algolia"
          ? await syncProductsToAlgolia(selectedIds)
          : platform === "meilisearch"
            ? await syncProductsToMeilisearch(selectedIds)
            : await syncProductsToWordPress(selectedIds);
      setSyncingPlatform(null);
      if ("error" in r) {
        reportError({
          source: `Sync · ${prettyPlatform(platform)}`,
          title: t("toast.syncError", { platform: prettyPlatform(platform) }),
          message: r.error,
          context: {
            platform,
            selectedProductIds: selectedIds,
            serverError: r.error,
          },
        });
        return;
      }
      const skipped = r.skippedCount ?? 0;
      if (r.failedCount === 0 && skipped === 0) {
        toast.success(
          t("toast.syncSuccess", {
            platform: prettyPlatform(platform),
            n: r.succeededCount,
          }),
        );
      } else {
        // Skipped products did NOT land in the index. Report honestly —
        // never a green success toast when something didn't sync.
        const msg =
          skipped > 0
            ? t("toast.syncSkipped", {
                platform: prettyPlatform(platform),
                ok: r.succeededCount,
                skipped,
                failed: r.failedCount,
              })
            : t("toast.syncPartial", {
                platform: prettyPlatform(platform),
                ok: r.succeededCount,
                failed: r.failedCount,
              });
        reportWarning({
          source: `Sync · ${prettyPlatform(platform)}`,
          title: msg,
          message: msg,
          context: {
            platform,
            productsCount: r.productsCount,
            succeededCount: r.succeededCount,
            failedCount: r.failedCount,
            skippedCount: skipped,
            logId: r.logId,
          },
        });
      }
      setSelected({});
    });
  }

  function prettyPlatform(p: Platform): string {
    if (p === "algolia") return "Algolia";
    if (p === "meilisearch") return "MeiliSearch";
    return "WooCommerce";
  }

  return (
    <div className="s-content">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: "0.5px solid var(--s-border)",
        }}
      >
        <div className="s-breadcrumb">
          <span>{t("breadcrumb")}</span>
        </div>
      </div>

      <div className="s-title-row">
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-meta">{t("subtitle")}</p>
        </div>
        <div className="s-title-actions" style={{ alignItems: "center" }}>
          <button
            type="button"
            className="s-btn s-btn-secondary"
            onClick={() => setShowLog((x) => !x)}
          >
            <Icon icon={History} size={14} />
            {t("history")}
          </button>
        </div>
      </div>

      {/* Status badges */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Badge label={t("badges.algoliaSynced", { n: counts.algolia.synced })} kind="success" />
        <Badge label={t("badges.algoliaPending", { n: counts.algolia.pending })} kind="warning" />
        <Badge label={t("badges.woocommerceSynced", { n: counts.woocommerce.synced })} kind="success" />
        <Badge label={t("badges.woocommercePending", { n: counts.woocommerce.pending })} kind="warning" />
        <Badge label={t("badges.meilisearchSynced", { n: counts.meilisearch.synced })} kind="success" />
        <Badge label={t("badges.meilisearchPending", { n: counts.meilisearch.pending })} kind="warning" />
      </div>

      {/* Configuration warnings */}
      {!algoliaConfigured ? (
        <ConfigStrip
          message={t("notConfigured.algolia")}
          ctaHref="/configuration/algolia"
          ctaLabel={t("notConfigured.cta")}
        />
      ) : null}
      {!woocommerceConfigured ? (
        <ConfigStrip
          message={t("notConfigured.woocommerce")}
          ctaHref="/configuration/woocommerce"
          ctaLabel={t("notConfigured.cta")}
        />
      ) : null}

      {/* Filter chips + mapping button */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--s-text-secondary)" }}>
          {t("filter.label")}
        </span>
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("filter.all", { n: rows.length })}
        </Chip>
        <Chip active={filter === "algolia-pending"} onClick={() => setFilter("algolia-pending")}>
          {t("filter.algoliaPending")}
        </Chip>
        <Chip active={filter === "wordpress-pending"} onClick={() => setFilter("wordpress-pending")}>
          {t("filter.woocommercePending")}
        </Chip>
        <Chip
          active={filter === "meilisearch-pending"}
          onClick={() => setFilter("meilisearch-pending")}
        >
          {t("filter.meilisearchPending")}
        </Chip>
        <Chip active={filter === "any-pending"} onClick={() => setFilter("any-pending")}>
          {t("filter.anyPending")}
        </Chip>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="s-btn s-btn-ghost"
          onClick={() => setShowMapping(true)}
        >
          <Icon icon={Settings2} size={14} />
          {t("mappingButton")}
        </button>
      </div>

      {/* Bulk toolbar */}
      {selectedCount > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: 16,
            background: "var(--scout-accent-50)",
            border: "0.5px solid var(--scout-accent-100)",
            borderRadius: "var(--s-radius-md)",
            marginBottom: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--scout-accent-800)",
              marginRight: 4,
            }}
          >
            {t("bulk.selected", { n: selectedCount })}
          </span>
          <button
            type="button"
            className="s-btn"
            style={{ background: "var(--s-success)", color: "white", border: "0.5px solid var(--s-success)" }}
            disabled={pending || !algoliaConfigured}
            onClick={() => runSync("algolia")}
          >
            {syncingPlatform === "algolia" ? (
              <SpinnerInline />
            ) : (
              <Icon icon={RefreshCw} size={14} />
            )}
            {t("bulk.syncAlgolia")}
          </button>
          <button
            type="button"
            className="s-btn"
            style={{ background: "var(--s-success)", color: "white", border: "0.5px solid var(--s-success)" }}
            disabled={pending || !woocommerceConfigured}
            onClick={() => runSync("woocommerce")}
          >
            {syncingPlatform === "woocommerce" ? (
              <SpinnerInline />
            ) : (
              <Icon icon={RefreshCw} size={14} />
            )}
            {t("bulk.syncWooCommerce")}
          </button>
          <button
            type="button"
            className="s-btn"
            style={{ background: "var(--s-success)", color: "white", border: "0.5px solid var(--s-success)" }}
            disabled={pending}
            onClick={() => runSync("meilisearch")}
          >
            {syncingPlatform === "meilisearch" ? (
              <SpinnerInline />
            ) : (
              <Icon icon={RefreshCw} size={14} />
            )}
            {t("bulk.syncMeilisearch")}
          </button>
          <button
            type="button"
            className="s-btn s-btn-ghost"
            onClick={() => setSelected({})}
          >
            {t("bulk.clear")}
          </button>
        </div>
      ) : null}

      {/* Table */}
      <div className="s-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: 640 }}>
          <table className="s-table" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((r) => selected[r.productId])}
                    onChange={toggleAll}
                  />
                </th>
                <th style={{ paddingLeft: 16 }}>{t("col.product")}</th>
                <th>{t("col.localUpdated")}</th>
                <th style={{ textAlign: "center" }}>Algolia</th>
                <th style={{ textAlign: "center" }}>{t("col.tienda")}</th>
                <th style={{ textAlign: "center" }}>MeiliSearch</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="s-empty">
                      <div className="s-empty-title">{t("empty.title")}</div>
                      <div className="s-empty-sub">{t("empty.sub")}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.productId}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!selected[r.productId]}
                        onChange={() => toggle(r.productId)}
                      />
                    </td>
                    <td style={{ paddingLeft: 16 }}>
                      <Link
                        href={`/catalog/products/${r.productId}`}
                        style={{ display: "block", color: "inherit", textDecoration: "none" }}
                      >
                        <div style={{ fontWeight: 500 }}>{r.productName}</div>
                        <div style={{ fontSize: 11, color: "var(--s-text-tertiary)" }}>
                          {r.slug} · {r.variantSkuCount} {t("col.variantsWithSku")}
                        </div>
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--s-text-tertiary)" }}>
                      {formatTime(r.effectiveUpdatedAt)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <StatusIcon status={r.algolia.status} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <StatusIcon status={r.woocommerce.status} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span title={r.meilisearch.note ?? undefined}>
                        <StatusIcon status={r.meilisearch.status} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log panel */}
      {showLog ? (
        <div className="s-card" style={{ marginTop: 20 }}>
          <p className="s-card-label">{t("log.title")}</p>
          <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "0 0 14px" }}>
            {t("log.subtitle")}
          </p>
          {logEntries.length === 0 ? (
            <div className="s-empty" style={{ padding: 24 }}>
              <div className="s-empty-sub">{t("log.empty")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {logEntries.map((e) => (
                <LogRow key={e.id} entry={e} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Mapping modal */}
      {showMapping ? (
        <div
          onClick={() => setShowMapping(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "var(--s-radius-lg)",
              padding: 24,
              maxWidth: 760,
              width: "92%",
              maxHeight: "88vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                marginBottom: 16,
                paddingBottom: 14,
                borderBottom: "0.5px solid var(--s-border)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
                {t("mappingModal.title")}
              </h2>
              <p style={{ fontSize: 12, color: "var(--s-text-secondary)", margin: "4px 0 0" }}>
                {t("mappingModal.subtitle")}
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 10,
                  paddingBottom: 6,
                  borderBottom: "0.5px solid var(--s-border)",
                }}
              >
                Algolia
              </h3>
              <FieldMappingTable rows={ALGOLIA_FIELD_MAPPINGS} />
            </div>

            <div>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 10,
                  paddingBottom: 6,
                  borderBottom: "0.5px solid var(--s-border)",
                }}
              >
                WooCommerce
              </h3>
              <FieldMappingTable rows={WOOCOMMERCE_FIELD_MAPPINGS} />
            </div>

            <div
              style={{
                marginTop: 20,
                paddingTop: 14,
                borderTop: "0.5px solid var(--s-border)",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="s-btn s-btn-secondary"
                onClick={() => setShowMapping(false)}
              >
                {t("mappingModal.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Badge({ label, kind }: { label: string; kind: "success" | "warning" }) {
  const m =
    kind === "success"
      ? { bg: "var(--s-success-bg)", color: "var(--s-success-text)", border: "var(--s-success)" }
      : { bg: "var(--s-warning-bg)", color: "var(--s-warning-text)", border: "var(--s-warning)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: "var(--s-radius-md)",
        fontSize: 12,
        fontWeight: 500,
        background: m.bg,
        color: m.color,
        border: `0.5px solid ${m.border}`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "currentColor",
        }}
      />
      {label}
    </span>
  );
}

function ConfigStrip({
  message,
  ctaHref,
  ctaLabel,
}: {
  message: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "var(--s-radius-md)",
        background: "var(--s-warning-bg)",
        border: "0.5px solid var(--s-warning)",
        color: "var(--s-warning-text)",
        fontSize: 12,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>{message}</span>
      <Link
        href={ctaHref}
        style={{
          marginLeft: "auto",
          fontSize: 12,
          color: "var(--scout-accent)",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        {ctaLabel} →
      </Link>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        border: "0.5px solid var(--s-border)",
        background: active ? "var(--scout-accent)" : "white",
        color: active ? "white" : "var(--s-text)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function StatusIcon({ status }: { status: SyncStatus }) {
  if (status === "synced")
    return <Icon icon={CheckCircle2} size={18} className="text-success" />;
  if (status === "pending")
    return <Icon icon={Clock} size={18} className="text-warning" />;
  return <Icon icon={Minus} size={18} className="text-muted" />;
}

function SpinnerInline() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid rgba(255,255,255,0.3)",
        borderTopColor: "white",
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
      }}
    />
  );
}

function LogRow({ entry }: { entry: SyncLogEntry }) {
  const t = useTranslations("sync");
  const platform =
    entry.platform === "algolia"
      ? "Algolia"
      : entry.platform === "meilisearch"
        ? "MeiliSearch"
        : "WooCommerce";
  const status =
    entry.status === "success"
      ? { color: "var(--s-success)", label: t("log.statusSuccess") }
      : entry.status === "partial"
        ? { color: "var(--s-warning)", label: t("log.statusPartial") }
        : entry.status === "error"
          ? { color: "var(--s-danger)", label: t("log.statusError") }
          : { color: "var(--s-text-tertiary)", label: t("log.statusRunning") };
  return (
    <div
      style={{
        padding: 12,
        borderRadius: "var(--s-radius-md)",
        background: "var(--s-surface-alt)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500 }}>{platform}</span>
        <span style={{ color: "var(--s-text-tertiary)" }}>{formatTime(entry.startedAt)}</span>
      </div>
      <div style={{ color: "var(--s-text-secondary)" }}>
        <span style={{ color: status.color, fontWeight: 500 }}>{status.label}</span>
        {" · "}
        {t("log.summary", {
          ok: entry.succeededCount,
          failed: entry.failedCount,
          total: entry.productsCount,
        })}
        {entry.errorMessage ? (
          <div style={{ marginTop: 4, color: "var(--s-danger-text)", fontSize: 11 }}>
            {entry.errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldMappingTable({
  rows,
}: {
  rows: ReadonlyArray<{
    scoutField: string;
    [k: string]: string | boolean | number | undefined;
    required: boolean;
    note: string;
  }>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => {
        const target = (r.algoliaField ?? r.wpField) as string;
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "260px 24px 1fr",
              gap: 12,
              alignItems: "start",
              padding: "10px 0",
              borderBottom: i < rows.length - 1 ? "0.5px solid var(--s-border)" : "none",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--s-text)" }}>
              <code style={{ fontFamily: "var(--s-font-mono)", fontSize: 11 }}>{r.scoutField}</code>
              {r.required ? (
                <span style={{ color: "var(--s-danger)", marginLeft: 4 }}>*</span>
              ) : null}
            </div>
            <div style={{ textAlign: "center", color: "var(--s-text-tertiary)" }}>→</div>
            <div>
              <code
                style={{
                  fontFamily: "var(--s-font-mono)",
                  fontSize: 11,
                  background: "var(--s-surface-alt)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {target}
              </code>
              <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 4 }}>
                {r.note}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString("es-GT", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
