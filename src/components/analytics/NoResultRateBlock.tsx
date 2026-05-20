"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BigValue } from "./MetricCard";
import { analyticsNoResultRate, type NoResultRateResult } from "@/lib/actions/search-analytics";

/** Percentage of searches that returned zero hits over the last N days. */
export function NoResultRateBlock({
  instanceId,
  days = 7,
}: {
  instanceId: number;
  days?: number;
}) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<NoResultRateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsNoResultRate(instanceId, days).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, days]);

  const loading = state === null;
  const error = state && !state.ok ? t("error.load") : null;
  const data = state && state.ok ? state : null;
  const empty = !!data && data.total === 0;

  return (
    <MetricCard
      title={t("noResultRate.title")}
      description={t("range.lastNDays", { n: days })}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("empty.noSearches")}
      loadingLabel={t("loading")}
      footer={
        data
          ? t("noResultRate.footer", {
              noResult: data.noResultCount,
              total: data.total,
            })
          : undefined
      }
    >
      {data ? (
        <BigValue
          value={`${(data.rate * 100).toFixed(2)}`}
          unit="%"
          tone={data.rate >= 0.2 ? "default" : "default"}
        />
      ) : null}
    </MetricCard>
  );
}
