"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  recentSearchRequests,
  type SearchRequestLogRow,
} from "./actions";

type Props = {
  instanceId: number;
};

const POLL_INTERVAL_MS = 2000;
const ROW_LIMIT = 50;

/**
 * Live tail of /api/v1/search requests for this instance. Used to diagnose
 * the WordPress plugin from inside GroLabs — every inbound call (success or
 * denial) appears here within ~2 seconds.
 *
 * Polling is paused when the document is hidden so we don't burn DB on a
 * background tab.
 */
export function SearchRequestLog({ instanceId }: Props) {
  const t = useTranslations("configuration.search.requestLog");
  const [rows, setRows] = useState<SearchRequestLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      if (inFlightRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlightRef.current = true;
      try {
        const r = await recentSearchRequests(instanceId, ROW_LIMIT);
        if (cancelled) return;
        if (r.ok) {
          setRows(r.rows);
          setError(null);
        } else {
          setError(r.error);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    fetchOnce();
    const id = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [instanceId]);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700">
        {t("error")}
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        {t("description", { count: rows.length })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">{t("col.time")}</th>
              <th className="px-2 py-1 font-medium">{t("col.query")}</th>
              <th className="px-2 py-1 font-medium">{t("col.origin")}</th>
              <th className="px-2 py-1 font-medium">{t("col.status")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("col.hits")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("col.meilisearch")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("col.total")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row }: { row: SearchRequestLogRow }) {
  const t = useTranslations("configuration.search.requestLog");
  const isSuccess = row.status === 200;
  const reasonKey = row.denialReason
    ? `reason.${row.denialReason}`
    : null;

  return (
    <tr className={isSuccess ? "border-t" : "border-t bg-red-500/5"}>
      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
        {formatTime(row.createdAt)}
      </td>
      <td className="px-2 py-1">
        {row.query ? (
          <span className="font-mono">{row.query}</span>
        ) : (
          <span className="text-muted-foreground">{t("emptyQuery")}</span>
        )}
      </td>
      <td className="px-2 py-1 truncate max-w-[160px] text-muted-foreground" title={row.origin ?? ""}>
        {row.origin ?? "—"}
      </td>
      <td className="px-2 py-1">
        <span
          className={
            isSuccess
              ? "rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
              : "rounded-sm bg-red-500/10 px-1.5 py-0.5 text-red-700"
          }
          title={reasonKey ? t(reasonKey) : undefined}
        >
          {row.status}
          {reasonKey ? ` · ${t(reasonKey)}` : ""}
        </span>
      </td>
      <td className="px-2 py-1 text-right tabular-nums">
        {isSuccess ? row.totalHits ?? 0 : "—"}
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
        {row.processingTimeMs != null && isSuccess ? `${row.processingTimeMs} ms` : "—"}
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
        {row.totalHandlerMs != null ? `${row.totalHandlerMs} ms` : "—"}
      </td>
    </tr>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}
