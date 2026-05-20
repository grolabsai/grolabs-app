"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  recentSearchEvents,
  searchEventCounts,
  type SearchEventCounts,
  type SearchEventRow,
} from "./actions";

type Props = {
  instanceId: number;
};

const POLL_INTERVAL_MS = 5000;
const ROW_LIMIT = 50;

const KNOWN_EVENT_NAMES = [
  "Search Result Clicked",
  "Added to cart from PLP",
  "Added to cart from PDP",
  "Proceeded to check out",
  "Completed order",
] as const;

/**
 * Live view of analytics_event for this instance — what the storefront has
 * emitted in the last ~24h. Pairs with the request-log panel above it:
 *   request-log = what the search backend SAW
 *   event-log   = what the storefront DID after
 *
 * Polls counts + recent rows together so the chip totals and the table can't
 * disagree (single render cycle). Pauses on hidden tab so a background admin
 * window doesn't run the query forever.
 */
export function SearchEventLog({ instanceId }: Props) {
  const t = useTranslations("configuration.search.eventLog");
  const [rows, setRows] = useState<SearchEventRow[] | null>(null);
  const [counts, setCounts] = useState<SearchEventCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      if (inFlightRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlightRef.current = true;
      try {
        const [eventsRes, countsRes] = await Promise.all([
          recentSearchEvents(instanceId, ROW_LIMIT),
          searchEventCounts(instanceId),
        ]);
        if (cancelled) return;
        if (eventsRes.ok && countsRes.ok) {
          setRows(eventsRes.rows);
          setCounts(countsRes.counts);
          setError(null);
        } else {
          setError("unauthorized");
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

  if (rows === null || counts === null) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CountsRow counts={counts} />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <EventsTable rows={rows} />
      )}
    </div>
  );
}

function CountsRow({ counts }: { counts: SearchEventCounts }) {
  const t = useTranslations("configuration.search.eventLog");
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        {t("countsHelp")}
      </div>
      <div className="flex flex-wrap gap-2">
        {KNOWN_EVENT_NAMES.map((name) => {
          const value = counts.byName[name] ?? 0;
          return (
            <span
              key={name}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs"
              title={name}
            >
              <span className="text-muted-foreground">{name}</span>
              <span className="font-medium tabular-nums">{value}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function EventsTable({ rows }: { rows: SearchEventRow[] }) {
  const t = useTranslations("configuration.search.eventLog");
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        {t("tableDescription", { count: rows.length })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">{t("col.time")}</th>
              <th className="px-2 py-1 font-medium">{t("col.event")}</th>
              <th className="px-2 py-1 font-medium">{t("col.product")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("col.position")}</th>
              <th className="px-2 py-1 font-medium">{t("col.queryUid")}</th>
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

function Row({ row }: { row: SearchEventRow }) {
  const t = useTranslations("configuration.search.eventLog");
  const isClick = row.eventType === "click";
  return (
    <tr className="border-t">
      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
        {formatTime(row.createdAt)}
      </td>
      <td className="px-2 py-1">
        <span
          className={
            isClick
              ? "rounded-sm bg-blue-500/10 px-1.5 py-0.5 text-blue-700"
              : "rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
          }
        >
          {row.eventName}
        </span>
      </td>
      <td className="px-2 py-1 truncate max-w-[260px]" title={row.objectName ?? ""}>
        {row.objectName ? (
          <span>
            <span className="font-mono text-muted-foreground">
              {row.objectId ? `#${row.objectId} ` : ""}
            </span>
            {row.objectName}
          </span>
        ) : row.objectId ? (
          <span className="font-mono">#{row.objectId}</span>
        ) : (
          <span className="text-muted-foreground">{t("noProduct")}</span>
        )}
      </td>
      <td className="px-2 py-1 text-right tabular-nums">
        {row.position == null ? "—" : row.position + 1}
      </td>
      <td className="px-2 py-1 truncate max-w-[160px] font-mono text-muted-foreground" title={row.queryUid ?? ""}>
        {row.queryUid ? row.queryUid.slice(0, 12) + "…" : "—"}
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
