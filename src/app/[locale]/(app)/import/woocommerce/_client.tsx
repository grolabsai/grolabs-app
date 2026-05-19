"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActivityStream } from "@/lib/activity-stream";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  FolderTree,
  Package,
  Loader2,
} from "lucide-react";
import {
  runWooCommerceImport,
  getImportStatus,
  type ImportStatus,
} from "./actions";
import type { DebugReport } from "@/lib/import/woocommerce/types";

type Props = {
  configured: boolean;
  siteUrl: string;
  initialStatus: ImportStatus;
};

/**
 * Owns the import page's full layout — controls/summary on the left, the
 * verbose debug log on the right. The right column is the agent-interaction
 * surface reserved per CLAUDE.md §14; while we're in debug mode it carries
 * the full structured import report so the user can audit exactly what was
 * created and linked.
 *
 * Both columns share a single polling loop, so we don't fire two
 * getImportStatus() calls per tick when an import is running.
 */
export function WooImportClient({ configured, siteUrl, initialStatus }: Props) {
  const t = useTranslations("import.woocommerce");
  const [status, setStatus] = useState<ImportStatus>(initialStatus);
  const [pending, startTransition] = useTransition();
  const { reportError } = useActivityStream();

  const isRunning = !!status.progress;
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    const tick = async () => {
      const next = await getImportStatus();
      if (!cancelled) setStatus(next);
    };
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isRunning]);

  function start(phase: "categories" | "products") {
    startTransition(async () => {
      setStatus((s) => ({
        ...s,
        progress: {
          jobId: 0,
          phase,
          page: 1,
          processed: 0,
          upserted: 0,
          failed: 0,
          startedAt: new Date().toISOString(),
        },
      }));
      const result = await runWooCommerceImport(phase);
      const fresh = await getImportStatus();
      setStatus(fresh);
      if (result.ok) {
        toast.success(t(`toast.success.${phase}`));
      } else {
        reportError({
          source: `WooCommerce import · ${phase}`,
          title: t("toast.failed"),
          message: result.error,
          context: {
            phase,
            jobId: fresh.lastJob?.jobId ?? null,
            jobStatus: fresh.lastJob?.status ?? null,
            serverError: fresh.lastJob?.errorMessage ?? result.error,
          },
        });
      }
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 1fr) minmax(420px, 1.4fr)",
        gap: 24,
        alignItems: "start",
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>
            {configured
              ? t("pageDescriptionConfigured", { siteUrl })
              : t("pageDescriptionMissing")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WooImportControls
            configured={configured}
            pending={pending}
            status={status}
            onStart={start}
          />
        </CardContent>
      </Card>

      <WooImportDebugPane status={status} />
    </div>
  );
}

// ─── Left column: controls + progress + summary + errors ───────────────────

function WooImportControls({
  configured,
  pending,
  status,
  onStart,
}: {
  configured: boolean;
  pending: boolean;
  status: ImportStatus;
  onStart: (phase: "categories" | "products") => void;
}) {
  const t = useTranslations("import.woocommerce");
  const isRunning = !!status.progress;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {!configured && (
        <div className="s-strip warning">
          <span className="s-strip-title">{t("notConfigured.title")}</span>
          <span className="s-strip-text">{t("notConfigured.body")}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button
          onClick={() => onStart("categories")}
          disabled={!configured || pending || isRunning}
          variant="default"
        >
          <Icon icon={FolderTree} size={14} />
          <span style={{ marginLeft: 8 }}>{t("buttons.importCategories")}</span>
        </Button>
        <Button
          onClick={() => onStart("products")}
          disabled={!configured || pending || isRunning}
          variant="default"
        >
          <Icon icon={Package} size={14} />
          <span style={{ marginLeft: 8 }}>{t("buttons.importProducts")}</span>
        </Button>
      </div>

      {status.progress && (
        <div className="s-card" style={{ padding: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Icon icon={Loader2} size={14} className="s-spin" />
            <span>
              {t(`progress.${status.progress.phase}`, {
                processed: status.progress.processed,
                upserted: status.progress.upserted,
                failed: status.progress.failed,
              })}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--s-text-muted)",
              marginTop: 6,
            }}
          >
            {t("progress.page", { page: status.progress.page })}
          </div>
        </div>
      )}

      {!status.progress && status.lastSummary && (
        <div className="s-card" style={{ padding: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            <Icon
              icon={status.lastSummary.failed === 0 ? CheckCircle2 : XCircle}
              size={14}
              className={
                status.lastSummary.failed === 0 ? "text-success" : "text-danger"
              }
            />
            <span>
              {t(`summary.title.${status.lastSummary.phase}`, {
                upserted: status.lastSummary.upserted,
                total: status.lastSummary.total,
              })}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--s-text-muted)",
              display: "grid",
              gridTemplateColumns: "auto auto",
              gap: "4px 16px",
            }}
          >
            <span>{t("summary.duration")}</span>
            <span className="tabular">
              {(status.lastSummary.durationMs / 1000).toFixed(1)}s
            </span>
            {status.lastSummary.failed > 0 && (
              <>
                <span>{t("summary.failed")}</span>
                <span className="tabular" style={{ color: "var(--s-danger)" }}>
                  {status.lastSummary.failed}
                </span>
              </>
            )}
            {status.lastSummary.renamedSlugs > 0 && (
              <>
                <span>{t("summary.renamedSlugs")}</span>
                <span className="tabular">{status.lastSummary.renamedSlugs}</span>
              </>
            )}
            {status.lastImportAt && (
              <>
                <span>{t("summary.completedAt")}</span>
                <span className="tabular">
                  {new Date(status.lastImportAt).toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {!status.progress && status.lastJob?.errorMessage && (
        <div className="s-card" style={{ padding: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 8,
              color: "var(--s-danger)",
            }}
          >
            {t("errors.title")}
          </div>
          <pre
            style={{
              fontSize: 12,
              fontFamily: "var(--s-font-mono, ui-monospace, monospace)",
              background: "var(--s-surface-2)",
              padding: 12,
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 240,
              overflow: "auto",
              margin: 0,
              color: "var(--s-text)",
            }}
          >
            {status.lastJob.errorMessage}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Right column: verbose debug report ────────────────────────────────────

function WooImportDebugPane({ status }: { status: ImportStatus }) {
  const t = useTranslations("import.woocommerce.debug");
  const report = status.lastDebug;
  const text = useMemo(() => (report ? renderDebugReport(report) : ""), [report]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!report ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--s-text-muted)",
              padding: "8px 0",
            }}
          >
            {t("empty")}
          </div>
        ) : (
          <pre
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              fontFamily: "var(--s-font-mono, ui-monospace, monospace)",
              background: "var(--s-surface-2)",
              padding: 14,
              borderRadius: 8,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "70vh",
              overflow: "auto",
              color: "var(--s-text)",
            }}
          >
            {text}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// Plain-text renderer. Deliberately verbose — we're in debug mode and the
// user wants every piece of evidence. Future versions can intercept the
// structured DebugReport object and render a friendlier UI.
function renderDebugReport(r: DebugReport): string {
  const lines: string[] = [];
  const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  lines.push(`PHASE: ${r.phase}`);
  lines.push(`Started:   ${r.startedAt}`);
  lines.push(`Completed: ${r.completedAt}`);
  lines.push(`Duration:  ${fmtMs(r.durationMs)}`);
  if (r.wcSettings) {
    lines.push(
      `WC settings: weight_unit=${r.wcSettings.weightUnit ?? "(unknown)"}, currency=${r.wcSettings.currency ?? "(default)"}`,
    );
  }
  lines.push("");
  lines.push("TOTALS");
  lines.push("------");
  const T = r.totals;
  const row = (label: string, n: number | undefined) =>
    n !== undefined ? `  ${label.padEnd(34, " ")} ${n}` : null;
  for (const ln of [
    row("Products processed", T.productsProcessed),
    row("Products upserted", T.productsUpserted),
    row("Products failed", T.productsFailed),
    row("Products with slug rename", T.productsRenamed),
    row("Categories upserted", T.categoriesUpserted),
    row("Variants upserted", T.variantsUpserted),
    row("Pricing rows upserted", T.pricingRowsUpserted),
    row("Tags upserted", T.tagsUpserted),
    row("Product↔tag links written", T.tagLinksWritten),
    row("Variant-axis attributes upserted", T.attributesUpserted),
    row("Attribute options upserted", T.attributeOptionsUpserted),
    row("Variant-attribute rows upserted", T.variantAttributeRowsUpserted),
    row("Category variant-axis flips", T.categoryAxisFlips),
  ]) {
    if (ln) lines.push(ln);
  }

  if (r.perProduct.length > 0) {
    lines.push("");
    lines.push(`PER-PRODUCT DETAIL (${r.perProduct.length} entries)`);
    lines.push("-".repeat(40));
    for (const p of r.perProduct) {
      lines.push("");
      lines.push(
        `• [wc#${p.woocommerceId}] ${p.name}${p.productId ? `   product_id=${p.productId}` : ""}${p.variable ? "   (variable)" : ""}`,
      );
      if (p.variants.length > 0) {
        lines.push(`   variants (${p.variants.length}):`);
        for (const v of p.variants) {
          const bits = [
            `wc#${v.wcId}`,
            v.sku ? `sku=${v.sku}` : null,
            v.name ? `name="${v.name}"` : null,
            v.weightGrams != null ? `weight=${v.weightGrams}g` : null,
          ].filter(Boolean);
          lines.push(`     - ${bits.join("  ")}`);
        }
      }
      if (p.variantAxes.length > 0) {
        lines.push(`   variant axes:`);
        for (const ax of p.variantAxes) {
          lines.push(
            `     · ${ax.code} ("${ax.name}") — options: ${ax.optionsSeen.join(", ") || "(none observed)"}`,
          );
        }
      }
      if (p.axisFlipsOnCategoryId != null) {
        lines.push(
          `   variant-axis flag set on category_id=${p.axisFlipsOnCategoryId}`,
        );
      }
      if (p.pricingRowsWritten > 0) {
        lines.push(`   pricing rows written: ${p.pricingRowsWritten}`);
      }
      if (p.tagsLinked.length > 0) {
        const labels = p.tagsLinked
          .map((t) => `${t.code}="${t.name}"`)
          .join(", ");
        lines.push(`   tags linked: ${labels}`);
      }
      for (const note of p.notes) {
        lines.push(`   note: ${note}`);
      }
    }
  }

  return lines.join("\n");
}
