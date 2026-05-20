"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BigValue } from "./MetricCard";
import { analyticsIndexHealth, type IndexHealthResult } from "@/lib/actions/search-analytics";
import { formatBytes } from "./format";

/** Meilisearch disk usage: total `databaseSize` (server-wide) headline + the
 * per-index slice (raw documents, average doc size). Calls the same action
 * as IndexHealthBlock — the round-trip is cheap and keeps each block fully
 * self-contained. */
export function IndexSizeBlock({ instanceId }: { instanceId: number }) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<IndexHealthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsIndexHealth(instanceId).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  const loading = state === null;
  const error = state && !state.ok ? t("error.load") : null;
  const data = state && state.ok ? state : null;
  const empty = !!data && data.databaseSize === 0;

  const total = data ? formatBytes(data.databaseSize) : null;
  const used = data ? formatBytes(data.usedDatabaseSize) : null;
  const raw = data ? formatBytes(data.rawDocumentDbSize) : null;

  return (
    <MetricCard
      title={t("indexSize.title")}
      description={t("indexSize.description")}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("indexSize.emptyIndex")}
      loadingLabel={t("loading")}
      footer={
        data
          ? t("indexSize.footer", {
              avg: data.avgDocumentSize > 0 ? formatBytes(data.avgDocumentSize).value : "0",
              unit: data.avgDocumentSize > 0 ? formatBytes(data.avgDocumentSize).unit : "B",
            })
          : undefined
      }
    >
      {data && total && used && raw ? (
        <div className="flex flex-col gap-2">
          <BigValue value={total.value} unit={total.unit} />
          <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground tabular-nums">
            <div>{t("indexSize.used", { value: used.value, unit: used.unit })}</div>
            <div>{t("indexSize.raw", { value: raw.value, unit: raw.unit })}</div>
          </div>
        </div>
      ) : null}
    </MetricCard>
  );
}
