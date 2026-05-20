"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "./MetricCard";
import { analyticsIndexHealth, type IndexHealthResult } from "@/lib/actions/search-analytics";

/** Per-field document counts from Meilisearch (`fieldDistribution`). Useful
 * for spotting attributes that are sparsely populated — a field present on
 * 5% of docs is unlikely to be a useful searchable attribute. */
export function FieldDistributionBlock({
  instanceId,
  limit = 12,
}: {
  instanceId: number;
  limit?: number;
}) {
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
  const rows = data ? data.fieldDistribution.slice(0, limit) : [];
  const empty = !!data && rows.length === 0;
  const top = rows[0]?.count ?? 1;

  return (
    <MetricCard
      title={t("fieldDistribution.title")}
      description={t("fieldDistribution.description")}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("indexHealth.emptyIndex")}
      loadingLabel={t("loading")}
    >
      {data ? (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => {
            const pct = top > 0 ? (row.count / top) * 100 : 0;
            return (
              <li key={row.field} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate font-mono text-muted-foreground">
                    {row.field}
                  </span>
                  <span className="tabular-nums">{row.count}</span>
                </div>
                <div className="h-1 w-full rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-primary/60"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </MetricCard>
  );
}
