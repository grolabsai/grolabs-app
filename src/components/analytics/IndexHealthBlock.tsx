"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BigValue } from "./MetricCard";
import { analyticsIndexHealth, type IndexHealthResult } from "@/lib/actions/search-analytics";
import { relativeAgo } from "./format";

/** Live index health: document count + indexing flag + last-update relative
 * time. Sourced from Meilisearch's `/stats` for this instance's index. */
export function IndexHealthBlock({ instanceId }: { instanceId: number }) {
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
  const empty = !!data && data.numberOfDocuments === 0;
  const ago = data ? relativeAgo(data.lastUpdate) : null;

  return (
    <MetricCard
      title={t("indexHealth.title")}
      description={t("indexHealth.description")}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("indexHealth.emptyIndex")}
      loadingLabel={t("loading")}
    >
      {data ? (
        <div className="flex flex-col gap-2">
          <BigValue
            value={data.numberOfDocuments.toLocaleString()}
            unit={t("indexHealth.docsUnit")}
          />
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span
              className={
                data.isIndexing
                  ? "rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-amber-700"
                  : "rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
              }
            >
              {data.isIndexing ? t("indexHealth.indexing") : t("indexHealth.idle")}
            </span>
            {ago ? (
              <span className="text-muted-foreground">
                {t(`indexHealth.ago.${ago.unit}`, { n: ago.value })}
              </span>
            ) : (
              <span className="text-muted-foreground">{t("indexHealth.never")}</span>
            )}
          </div>
        </div>
      ) : null}
    </MetricCard>
  );
}
