"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "./MetricCard";
import { analyticsTopQueries, type TopQueriesResult } from "@/lib/actions/search-analytics";

/** Top-N most-searched queries from `query_log` over the last N days. */
export function TopQueriesBlock({
  instanceId,
  days = 7,
  limit = 10,
}: {
  instanceId: number;
  days?: number;
  limit?: number;
}) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<TopQueriesResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsTopQueries(instanceId, days, limit).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, days, limit]);

  const loading = state === null;
  const error = state && !state.ok ? t("error.load") : null;
  const data = state && state.ok ? state : null;
  const empty = !!data && data.rows.length === 0;

  return (
    <MetricCard
      title={t("topQueries.title")}
      description={t("range.lastNDays", { n: days })}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("empty.noSearches")}
      loadingLabel={t("loading")}
    >
      {data ? (
        <ol className="flex flex-col gap-1">
          {data.rows.map((row, i) => (
            <li
              key={`${row.query}-${i}`}
              className="flex items-baseline gap-2 text-xs"
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                {i + 1}.
              </span>
              <span className="flex-1 truncate font-mono">{row.query}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.count}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </MetricCard>
  );
}
