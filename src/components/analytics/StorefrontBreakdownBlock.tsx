"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "./MetricCard";
import {
  analyticsStorefrontBreakdown,
  type StorefrontBreakdownResult,
} from "@/lib/actions/search-analytics";

/** Per-origin breakdown of inbound /api/v1/search calls. Useful when an
 * instance has multiple authorized storefront domains (staging + prod, two
 * brands sharing one catalog) to see which one drives traffic. */
export function StorefrontBreakdownBlock({
  instanceId,
  days = 7,
}: {
  instanceId: number;
  days?: number;
}) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<StorefrontBreakdownResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsStorefrontBreakdown(instanceId, days).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, days]);

  const loading = state === null;
  const error = state && !state.ok ? t("error.load") : null;
  const data = state && state.ok ? state : null;
  const empty = !!data && data.rows.length === 0;
  const total = data ? data.rows.reduce((acc, r) => acc + r.count, 0) : 0;

  return (
    <MetricCard
      title={t("storefronts.title")}
      description={t("range.lastNDays", { n: days })}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("empty.noSearches")}
      loadingLabel={t("loading")}
    >
      {data ? (
        <ul className="flex flex-col gap-1">
          {data.rows.map((row, i) => {
            const pct = total > 0 ? (row.count / total) * 100 : 0;
            return (
              <li
                key={`${row.origin ?? "unknown"}-${i}`}
                className="flex items-baseline gap-2 text-xs"
              >
                <span className="flex-1 truncate font-mono">
                  {row.origin ?? t("storefronts.unknown")}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
                <span className="w-12 text-right tabular-nums">{row.count}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </MetricCard>
  );
}
