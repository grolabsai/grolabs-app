/**
 * Aggregate Algolia "searches with no results" for the dashboard KPI tile.
 * The full table that supports add-synonym lives in
 * src/app/[locale]/(app)/dashboard/_no-results-table.tsx (unchanged).
 *
 * This fetcher derives:
 *   - total count of distinct no-results searches over the selected range
 *   - daily-bucket sparkline (last 7 days) for the inline chart
 *   - delta vs the prior equal-length window
 *
 * Algolia's /2/searches/noResults endpoint returns a list capped at limit=1000;
 * we treat the response length as the count for the window.
 */

import { createClient } from "@/lib/supabase/server";
import type { DashboardRange } from "@/lib/integrations/ga4/range";

interface AlgoliaConfig {
  app_id?: string;
  region?: string;
  primary_index?: string;
}

interface AlgoliaNoResultsRow {
  search?: string;
  count?: number;
}

function analyticsHost(region: string): string {
  switch (region) {
    case "us":
      return "analytics.us.algolia.com";
    case "eu":
    case "de":
      return "analytics.de.algolia.com";
    default:
      return "analytics.us.algolia.com";
  }
}

function rangeWindow(range: DashboardRange): { days: number } {
  switch (range) {
    case "hoy":
      return { days: 1 };
    case "ayer":
      return { days: 1 };
    case "7d":
      return { days: 7 };
    case "30d":
      return { days: 30 };
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(d: Date, daysAgo: number): { startDate: string; endDate: string } {
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() - daysAgo);
  return { startDate: isoDate(end), endDate: isoDate(end) };
}

export interface NoResultsSummary {
  ok: boolean;
  configured: boolean;
  count: number;
  countPrev: number;
  deltaPct: number;
  spark: { date: string; value: number }[];
}

const EMPTY: NoResultsSummary = {
  ok: false,
  configured: false,
  count: 0,
  countPrev: 0,
  deltaPct: 0,
  spark: [],
};

/**
 * One Algolia call per day for the trailing 7 days plus one call for the
 * prior equal-length window (used as the comparison baseline).
 */
export async function getNoResultsSummary(
  instanceId: number,
  range: DashboardRange = "7d",
): Promise<NoResultsSummary> {
  const supabase = await createClient();
  const { data: instanceRow } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", instanceId)
    .maybeSingle();

  const algolia: AlgoliaConfig =
    (instanceRow?.integrations_config as { algolia?: AlgoliaConfig })
      ?.algolia ?? {};
  if (!algolia.app_id || !algolia.region || !algolia.primary_index) {
    return EMPTY;
  }

  const { data: adminKey } = await supabase.rpc("algolia_get_admin_key", {
    p_instance_id: instanceId,
  });
  if (!adminKey) return { ...EMPTY, configured: true };

  const host = analyticsHost(algolia.region);
  const indexParam = encodeURIComponent(algolia.primary_index);
  const headers = {
    "x-algolia-application-id": algolia.app_id,
    "x-algolia-api-key": adminKey as string,
    accept: "application/json",
  };

  async function dailyCount(startDate: string, endDate: string): Promise<number> {
    const url =
      `https://${host}/2/searches/noResults` +
      `?index=${indexParam}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&limit=1000`;
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) return 0;
      const json = (await res.json()) as { searches?: AlgoliaNoResultsRow[] };
      const rows = json.searches ?? [];
      // Sum the per-term counts; fall back to row count if `count` missing.
      return rows.reduce((s, r) => s + (r.count ?? 1), 0);
    } catch {
      return 0;
    }
  }

  const { days } = rangeWindow(range);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Sparkline: trailing 7 daily buckets (regardless of selected range, so the
  // chart shape stays comparable across selections).
  const sparkPromises: Promise<{ date: string; value: number }>[] = [];
  for (let i = 6; i >= 0; i--) {
    const { startDate, endDate } = fmt(today, i);
    sparkPromises.push(
      dailyCount(startDate, endDate).then((value) => ({ date: startDate, value })),
    );
  }
  const spark = await Promise.all(sparkPromises);

  // Current window total.
  const startWindow = new Date(today);
  startWindow.setUTCDate(startWindow.getUTCDate() - (days - 1));
  const count = await dailyCount(isoDate(startWindow), isoDate(today));

  // Prior window of equal length for comparison.
  const startPrev = new Date(startWindow);
  startPrev.setUTCDate(startPrev.getUTCDate() - days);
  const endPrev = new Date(startWindow);
  endPrev.setUTCDate(endPrev.getUTCDate() - 1);
  const countPrev = await dailyCount(isoDate(startPrev), isoDate(endPrev));

  const deltaPct =
    countPrev > 0 ? ((count - countPrev) / countPrev) * 100 : 0;

  return {
    ok: true,
    configured: true,
    count,
    countPrev,
    deltaPct,
    spark,
  };
}
