"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft, RefreshCw, CheckCheck, Undo2 } from "lucide-react";
import { Link } from "@/i18n/routing";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  recomputeBatch,
  setBatchStatus,
  updateBatchName,
  type BatchDetail,
} from "@/lib/actions/pricing";
import { SyncBatchButton } from "@/components/pricing/SyncBatchButton";
import { formatRelative } from "@/lib/format";

/**
 * Header strip for the worksheet — back link, editable batch name,
 * status pill, and the action buttons that drive status transitions
 * and recompute.
 *
 * Inline name edit pattern:
 *   - Click the name → flips into a focused input.
 *   - Enter or blur → saves via updateBatchName.
 *   - Escape → cancels and reverts.
 *
 * Action visibility:
 *   - draft  → "Recalcular" + "Marcar como listo"
 *   - ready  → "Volver a editar" (sync button is reserved for the future
 *              sync PR; we omit it entirely here to keep state honest)
 *   - synced → no actions; everything is locked.
 */
export function WorksheetHeader({
  batch,
  onMutated,
}: {
  batch: BatchDetail;
  /** Called after any action that changed the batch — page refreshes. */
  onMutated: () => void;
}) {
  const t = useTranslations("pricing.batchDetail");
  const router = useRouter();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(batch.batch_name);
  const [savingName, startSaveName] = useTransition();
  const [recomputing, startRecompute] = useTransition();
  const [transitioning, startTransition] = useTransition();

  const isLocked = batch.status === "synced";

  function commitName() {
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === batch.batch_name) {
      setEditingName(false);
      setNameDraft(batch.batch_name);
      return;
    }
    startSaveName(async () => {
      const res = await updateBatchName(batch.price_batch_id, trimmed);
      if (!res.ok) {
        toast.error(t("toast.saveNameError"), { description: res.error });
        setNameDraft(batch.batch_name);
      } else {
        toast.success(t("toast.savedName"));
        onMutated();
      }
      setEditingName(false);
    });
  }

  function onRecompute() {
    startRecompute(async () => {
      const res = await recomputeBatch(batch.price_batch_id);
      if (!res.ok) {
        toast.error(t("toast.recomputeError"), { description: res.error });
        return;
      }
      toast.success(t("toast.recomputed"));
      onMutated();
    });
  }

  function onMarkReady() {
    startTransition(async () => {
      const res = await setBatchStatus(batch.price_batch_id, "ready");
      if (!res.ok) {
        toast.error(t("toast.readyError"), { description: res.error });
        return;
      }
      toast.success(t("toast.markedReady"));
      onMutated();
    });
  }

  function onBackToDraft() {
    startTransition(async () => {
      const res = await setBatchStatus(batch.price_batch_id, "draft");
      if (!res.ok) {
        toast.error(t("toast.backToDraftError"), { description: res.error });
        return;
      }
      toast.success(t("toast.backToDraft"));
      onMutated();
    });
  }

  return (
    <>
      <div style={{ marginTop: -56, marginBottom: 16 }}>
        <Link
          href="/pricing/changes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "var(--s-text-tertiary)",
            textDecoration: "none",
          }}
        >
          <Icon icon={ChevronLeft} size={14} strokeWidth={2} />
          {t("back")}
        </Link>
      </div>

      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {editingName && !isLocked ? (
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setNameDraft(batch.batch_name);
                  setEditingName(false);
                }
              }}
              autoFocus
              disabled={savingName}
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--s-text)",
                width: "100%",
                background: "transparent",
                border: "1px solid var(--scout-accent)",
                borderRadius: "var(--s-radius-md)",
                padding: "4px 8px",
                marginBottom: 6,
                outline: "none",
              }}
            />
          ) : (
            <h1
              onClick={() => !isLocked && setEditingName(true)}
              title={isLocked ? undefined : t("clickToEdit")}
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--s-text)",
                marginBottom: 6,
                cursor: isLocked ? "default" : "text",
                padding: "4px 8px",
                margin: "-4px -8px 2px",
                borderRadius: "var(--s-radius-md)",
              }}
            >
              {batch.batch_name}
            </h1>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: "var(--s-text-tertiary)",
            }}
          >
            <span className={`pricing-status-pill ${batch.status}`}>
              {t(`status.${batch.status}`)}
            </span>
            <span>·</span>
            <span>{t("itemCount", { n: batch.item_count })}</span>
            <span>·</span>
            <span>{formatRelative(batch.updated_at)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {batch.status === "draft" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onRecompute}
                disabled={recomputing}
              >
                <Icon icon={RefreshCw} size={14} strokeWidth={2} />
                <span style={{ marginLeft: 6 }}>
                  {recomputing
                    ? t("buttons.recomputing")
                    : t("buttons.recompute")}
                </span>
              </Button>
              <Button
                type="button"
                onClick={onMarkReady}
                disabled={transitioning || batch.critical_count > 0}
                title={
                  batch.critical_count > 0
                    ? t("buttons.markReadyBlockedHint")
                    : undefined
                }
              >
                <Icon icon={CheckCheck} size={14} strokeWidth={2} />
                <span style={{ marginLeft: 6 }}>
                  {t("buttons.markReady")}
                </span>
              </Button>
            </>
          ) : null}
          {batch.status === "ready" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onBackToDraft}
                disabled={transitioning}
              >
                <Icon icon={Undo2} size={14} strokeWidth={2} />
                <span style={{ marginLeft: 6 }}>
                  {t("buttons.backToDraft")}
                </span>
              </Button>
              <SyncBatchButton batchId={batch.price_batch_id} size="default" />
            </>
          ) : null}
        </div>
      </header>
    </>
  );
}
