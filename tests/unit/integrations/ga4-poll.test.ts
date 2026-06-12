import { describe, expect, it } from "vitest";

import { mergePageRows } from "@/lib/integrations/ga4/poll";
import type { RunReportResponse } from "@/lib/integrations/ga4/client";

/**
 * mergePageRows is the trickiest pure transform in the GA4 pull: it folds two
 * GA4 reports keyed by path into one ga4_page_daily row set —
 *   - the pagePath report supplies views + engagement, and
 *   - the landingPage report supplies "entrances" (GA4 has no `entrances`
 *     metric, so sessions-that-started-on-a-page stand in).
 * GA4 has no exits metric at all, so `exits` must always be 0.
 *
 * These two reports caused two production HTTP-400s before the metrics were
 * corrected; this guards the merge logic that replaced them.
 */

const INSTANCE = 0;
const DATE = "2026-06-11";

function report(
  rows: Array<{ dim: string; metrics: number[] }>,
): RunReportResponse {
  return {
    rows: rows.map((r) => ({
      dimensionValues: [{ value: r.dim }],
      metricValues: r.metrics.map((v) => ({ value: String(v) })),
    })),
  };
}

describe("mergePageRows", () => {
  it("merges views/engagement (pagePath) with entrances (landingPage) by path", () => {
    const pageR = report([
      { dim: "/home", metrics: [/* views */ 100, /* engagement */ 3200] },
      { dim: "/pricing", metrics: [40, 800] },
    ]);
    const landingR = report([
      { dim: "/home", metrics: [/* sessions */ 25] },
    ]);

    const out = mergePageRows(INSTANCE, DATE, pageR, landingR);
    const home = out.find((r) => r.page_path === "/home")!;
    const pricing = out.find((r) => r.page_path === "/pricing")!;

    expect(home).toMatchObject({
      instance_id: INSTANCE,
      date: DATE,
      page_path: "/home",
      views: 100,
      entrances: 25, // from the landingPage report
      exits: 0, // GA4 has no exits metric
      avg_engagement_time_sec: 3200,
    });
    // A page that's viewed but never a landing page keeps entrances at 0.
    expect(pricing.entrances).toBe(0);
    expect(pricing.views).toBe(40);
  });

  it("includes landing-only paths (entrances with no recorded views)", () => {
    const out = mergePageRows(
      INSTANCE,
      DATE,
      report([]),
      report([{ dim: "/lp", metrics: [12] }]),
    );
    expect(out).toEqual([
      {
        instance_id: INSTANCE,
        date: DATE,
        page_path: "/lp",
        views: 0,
        entrances: 12,
        exits: 0,
        avg_engagement_time_sec: 0,
      },
    ]);
  });

  it("never emits an exits value and handles empty reports", () => {
    expect(mergePageRows(INSTANCE, DATE, report([]), report([]))).toEqual([]);

    const out = mergePageRows(
      INSTANCE,
      DATE,
      report([{ dim: "/a", metrics: [5, 10] }]),
      report([]),
    );
    expect(out.every((r) => r.exits === 0)).toBe(true);
  });
});
