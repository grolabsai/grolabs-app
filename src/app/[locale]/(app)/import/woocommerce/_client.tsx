"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActivityStream } from "@/lib/activity-stream";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, FolderTree, Package, Loader2 } from "lucide-react";
import {
  runWooCommerceImport,
  getImportStatus,
  type ImportStatus,
} from "./actions";

type Props = {
  configured: boolean;
  initialStatus: ImportStatus;
};

export function WooImportPanel({ configured, initialStatus }: Props) {
  const t = useTranslations("import.woocommerce");
  const [status, setStatus] = useState<ImportStatus>(initialStatus);
  const [pending, startTransition] = useTransition();
  const { reportError } = useActivityStream();

  // While a run is in progress, poll status every 1.5s.
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
      // Optimistic progress entry so the UI flips immediately.
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {!configured && (
        <div className="s-strip warning">
          <span className="s-strip-title">{t("notConfigured.title")}</span>
          <span className="s-strip-text">{t("notConfigured.body")}</span>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button
          onClick={() => start("categories")}
          disabled={!configured || pending || isRunning}
          variant="default"
        >
          <Icon icon={FolderTree} size={14} />
          <span style={{ marginLeft: 8 }}>{t("buttons.importCategories")}</span>
        </Button>
        <Button
          onClick={() => start("products")}
          disabled={!configured || pending || isRunning}
          variant="default"
        >
          <Icon icon={Package} size={14} />
          <span style={{ marginLeft: 8 }}>{t("buttons.importProducts")}</span>
        </Button>
      </div>

      {/* Live progress */}
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

      {/* Last-run summary */}
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

      {/* Error panel */}
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
