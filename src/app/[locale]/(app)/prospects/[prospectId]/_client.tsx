"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { rescanAllProspectPages, rescanProspectPage } from "./_actions";

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
        <div style={{ fontSize: 11, color: "var(--s-danger)" }}>{error}</div>
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
        className="s-btn"
        onClick={handleClick}
        disabled={isPending}
        style={{ fontSize: 11, padding: "4px 10px", height: 26 }}
      >
        {isPending ? t("scanning") : t("rescan")}
      </button>
      {err && <span style={{ fontSize: 10, color: "var(--s-danger)" }}>{err}</span>}
    </div>
  );
}
