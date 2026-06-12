"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
import {
  addProspectPage,
  rescanAllProspectPages,
  rescanProspectPage,
} from "./_actions";
import { HintedInput, HintedSelect } from "@/components/ui/hinted-field";

/**
 * Header actions on the prospect detail page: a "scan all" button.
 * Per-page "rescan" button lives in <RescanPageClient> below since
 * it's rendered inside table rows.
 */
export function ProspectActions({
  prospectId,
  hasPages,
}: {
  prospectId: number;
  hasPages: boolean;
}) {
  const t = useTranslations("prospects.detail");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleScanAll() {
    setError(null);
    startTransition(async () => {
      const result = await rescanAllProspectPages({ prospectId });
      if ("error" in result) {
        setError(result.error ?? null);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        type="button"
        className="s-btn s-btn-primary"
        onClick={handleScanAll}
        disabled={isPending || !hasPages}
        style={{ height: 36 }}
      >
        {isPending ? t("scanning") : t("scanAll")}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: "var(--gl-danger)" }}>{error}</div>
      )}
    </div>
  );
}

export function RescanPageClient({ prospectPageId }: { prospectPageId: number }) {
  const t = useTranslations("prospects.detail");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setErr(null);
    startTransition(async () => {
      const result = await rescanProspectPage({ prospectPageId });
      if ("error" in result) {
        setErr(result.error ?? null);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        className="s-btn s-btn-primary"
        onClick={handleClick}
        disabled={isPending}
        style={{ fontSize: 11, padding: "4px 10px", height: 26 }}
      >
        {isPending ? t("scanning") : t("rescan")}
      </button>
      {err && <span style={{ fontSize: 10, color: "var(--gl-danger)" }}>{err}</span>}
    </div>
  );
}

// ── Add page form ──────────────────────────────────────────────────────
// Inline expandable form on the prospect detail page's pages table.
// The user picks the page type (homepage / pdp / category) so the
// runner knows which evaluation lane to route this URL through.

export function AddProspectPageForm({ prospectId }: { prospectId: number }) {
  const t = useTranslations("prospects.detail");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [pageType, setPageType] = useState<"homepage" | "pdp" | "category">(
    "pdp",
  );
  const [label, setLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!url.trim()) {
      toast.error(t("addPageEmptyUrl"));
      return;
    }
    startTransition(async () => {
      const res = await addProspectPage({
        prospect_id: prospectId,
        url,
        page_type: pageType,
        label,
      });
      if ("error" in res) {
        const msg =
          res.error === "DUPLICATE_URL"
            ? t("addPageDuplicate")
            : res.error === "INVALID_URL"
              ? t("addPageInvalidUrl")
              : res.error;
        toast.error(msg);
        return;
      }
      toast.success(t("addPageCreated"));
      setUrl("");
      setLabel("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div
        style={{
          padding: "10px 16px",
          borderTop: "0.5px solid var(--gl-border)",
        }}
      >
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={() => setOpen(true)}
          style={{ fontSize: 12, padding: "6px 14px" }}
        >
          + {t("addPageButton")}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        borderTop: "0.5px solid var(--gl-border)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "160px 1fr 1fr",
          gap: 12,
        }}
      >
        <HintedSelect
          id={`add-page-type-${prospectId}`}
          label={t("addPageTypeLabel")}
          value={pageType}
          onChange={(e) =>
            setPageType(e.target.value as "homepage" | "pdp" | "category")
          }
          hint={{
            label: t("addPageTypeLabel"),
            body: t("addPageTypeHint"),
          }}
        >
          <option value="homepage">{t("addPageTypeHomepage")}</option>
          <option value="pdp">{t("addPageTypePdp")}</option>
          <option value="category">{t("addPageTypeCategory")}</option>
        </HintedSelect>
        <HintedInput
          id={`add-page-url-${prospectId}`}
          label={t("addPageUrlLabel")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="font-mono"
          hint={{
            label: t("addPageUrlLabel"),
            body: t("addPageUrlHint"),
          }}
        />
        <HintedInput
          id={`add-page-label-${prospectId}`}
          label={t("addPageLabelLabel")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          hint={{
            label: t("addPageLabelLabel"),
            body: t("addPageLabelHint"),
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="s-btn"
          onClick={() => {
            setOpen(false);
            setUrl("");
            setLabel("");
          }}
          disabled={isPending}
          style={{ fontSize: 12, padding: "6px 14px" }}
        >
          {t("addPageCancel")}
        </button>
        <button
          type="button"
          className="s-btn s-btn-primary"
          onClick={submit}
          disabled={isPending}
          style={{ fontSize: 12, padding: "6px 14px" }}
        >
          {isPending ? t("addPageSaving") : t("addPageSave")}
        </button>
      </div>
    </div>
  );
}
