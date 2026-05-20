"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MetricCard, BigValue } from "./MetricCard";
import { analyticsSearchVolume, type SearchVolumeResult } from "@/lib/actions/search-analytics";

/**
 * Total successful /api/v1/search calls in the last N days, with a small
 * inline sparkline of the per-day series. Sourced from `query_log`.
 *
 * Drop-in props: `instanceId`, optional `days` (default 7).
 */
export function SearchVolumeBlock({
  instanceId,
  days = 7,
}: {
  instanceId: number;
  days?: number;
}) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<SearchVolumeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsSearchVolume(instanceId, days).then((r) => {
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
  const avg = data && data.days > 0 ? Math.round(data.total / data.days) : 0;

  return (
    <MetricCard
      title={t("searchVolume.title")}
      description={t("range.lastNDays", { n: days })}
      loading={loading}
      error={error}
      empty={empty}
      emptyLabel={t("empty.noSearches")}
      loadingLabel={t("loading")}
      footer={
        data
          ? t("searchVolume.footer", { avg })
          : undefined
      }
    >
      {data ? (
        <>
          <BigValue value={data.total.toLocaleString()} unit={t("searchVolume.unit")} />
          <Sparkline series={data.perDay.map((p) => p.count)} />
        </>
      ) : null}
    </MetricCard>
  );
}

/** Tiny inline sparkline — pure SVG, no charting library. Renders a smooth
 * polyline across a fixed 200x32 canvas. */
function Sparkline({ series }: { series: number[] }) {
  if (series.length === 0) return null;
  const W = 200;
  const H = 32;
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? W / (series.length - 1) : 0;
  const pts = series
    .map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-primary">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}
