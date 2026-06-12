"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/routing";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { addSynonym } from "./actions";

export type NoResultRow = {
  search: string;
  count: number;
  withFilterCount: number;
};

type Props = {
  rows: NoResultRow[];
  timeWindow: "24h" | "7d" | "30d";
  offset: number;
  hasMore: boolean;
};

export function NoResultsTable({ rows, timeWindow, offset, hasMore }: Props) {
  const t = useTranslations("dashboard");
  const router = useRouter();

  const [dialogQuery, setDialogQuery] = useState<string | null>(null);
  const [synonymValue, setSynonymValue] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleWindowChange(value: string) {
    router.push(`/dashboard/search?window=${value}&offset=0`);
  }

  function handleLoadMore() {
    router.push(`/dashboard/search?window=${timeWindow}&offset=${offset + 50}`);
  }

  function openDialog(query: string) {
    setDialogQuery(query);
    setSynonymValue("");
  }

  function closeDialog() {
    setDialogQuery(null);
    setSynonymValue("");
  }

  function handleSave() {
    if (!dialogQuery || !synonymValue.trim()) return;
    const query = dialogQuery;
    const syn = synonymValue.trim();
    startTransition(async () => {
      const result = await addSynonym(query, syn);
      if (result.ok) {
        toast.success(t("synonym.toastSuccess", { query, synonym: syn }));
        closeDialog();
      } else {
        toast.error(result.error ?? t("synonym.toastFailed"));
      }
    });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Select value={timeWindow} onValueChange={handleWindowChange}>
          <SelectTrigger style={{ width: 140 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">{t("noResults.window.day")}</SelectItem>
            <SelectItem value="7d">{t("noResults.window.week")}</SelectItem>
            <SelectItem value="30d">{t("noResults.window.month")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            textAlign: "center",
            color: "var(--muted-foreground)",
            padding: "24px 0",
            fontSize: 14,
          }}
        >
          {t("noResults.empty")}
        </p>
      ) : (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  {t("noResults.columns.query")}
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  {t("noResults.columns.count")}
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  {t("noResults.columns.withFilter")}
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  {t("noResults.columns.action")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.search}>
                  <td
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {row.search}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--border)",
                      textAlign: "right",
                    }}
                  >
                    {row.count}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted-foreground)",
                      fontSize: 12,
                    }}
                  >
                    {row.withFilterCount > 0
                      ? t("noResults.withFilterText", {
                          n: row.withFilterCount,
                          total: row.count,
                        })
                      : null}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--border)",
                      textAlign: "right",
                    }}
                  >
                    <button
                      className="s-btn s-btn-secondary"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      onClick={() => openDialog(row.search)}
                    >
                      {t("noResults.actions.addSynonym")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="s-btn s-btn-secondary" onClick={handleLoadMore}>
                {t("noResults.actions.loadMore")}
              </button>
            </div>
          )}
        </>
      )}

      <Dialog
        open={dialogQuery !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("synonym.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div>
              <p
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted-foreground)",
                  marginBottom: 4,
                  fontWeight: 500,
                }}
              >
                {t("synonym.queryLabel")}
              </p>
              <p
                style={{
                  fontSize: 14,
                  padding: "8px 12px",
                  background: "var(--muted)",
                  borderRadius: 6,
                  fontWeight: 500,
                }}
              >
                &ldquo;{dialogQuery}&rdquo;
              </p>
            </div>
            <FloatingLabelInput
              id="synonym-input"
              label={t("synonym.synonymLabel")}
              value={synonymValue}
              onChange={(e) => setSynonymValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus
            />
            <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {t("synonym.note")}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button className="s-btn s-btn-secondary" onClick={closeDialog}>
                {t("synonym.cancel")}
              </button>
            </DialogClose>
            <button
              className="s-btn s-btn-primary"
              onClick={handleSave}
              disabled={isPending || !synonymValue.trim()}
            >
              {t("synonym.save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
