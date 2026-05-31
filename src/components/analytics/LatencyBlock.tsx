"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BigValue } from "./MetricCard";
import { analyticsLatency, type LatencyResult } from "@/lib/actions/search-analytics";

/** p50 + p95 latency for both Meilisearch (`processing_time_ms`) and the
 * full RRE handler (`total_handler_ms`) over the last N days. */
export function LatencyBlock({
  instanceId,
  days = 7,
}: {
  instanceId: number;
  days?: number;
}) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<LatencyResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsLatency(instanceId, days).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, days]);

  const loading = state === null;
  const error = state && !state.ok ? t("error.load") : null;
  const data = state && state.ok ? state : null;
  const empty = !!data && data.sampleSize === 0;

  return (
    <MetricCard
      title={t("latency.title")}
      description={t("range.lastNDays", { n: days })}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("empty.noSearches")}
      loadingLabel={t("loading")}
      footer={
        data
          ? t("latency.footer", { samples: data.sampleSize })
          : undefined
      }
    >
      {data ? (
        <div className="flex flex-col gap-3">
          <div>
            <BigValue value={data.meiliP50} unit="ms p50" />
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {t("latency.meiliP95", { ms: data.meiliP95 })}
            </div>
          </div>
          <div className="border-t pt-2 text-xs text-muted-foreground tabular-nums">
            {t("latency.handler", {
              p50: data.handlerP50,
              p95: data.handlerP95,
            })}
          </div>
        </div>
      ) : null}
    </MetricCard>
  );
}
