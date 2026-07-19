/**
 * Sanity harness for the Signals engine, run against the REAL instance-12
 * weekly aggregates (pulled from metric_daily on 2026-07-18) so the states the
 * dashboard will show are inspectable before the page ever renders.
 *
 * Not a permanent fixture-contract — a design-session verification harness.
 */
import { describe, it, expect } from "vitest";
import { analyzeSeries, bucketWeeks, mondayOf, rolling7 } from "@/lib/analytics/signals";

// Instance 12, closed weeks May 4 … Jul 6 (from SQL recon).
const conv = [31 / 387, 19 / 394, 36 / 393, 33 / 447, 40 / 451, 40 / 477, 57 / 652, 50 / 534, 55 / 552, 41 / 588];
const noResult = [103 / 595, 90 / 591, 74 / 602, 90 / 671, 92 / 676, 77 / 736, 83 / 986, 57 / 798, 52 / 813, 42 / 885];
const orders = [32, 19, 36, 33, 40, 40, 57, 50, 55, 41];

describe("signals engine vs real instance-12 data", () => {
  it("mondayOf is correct across the week", () => {
    expect(mondayOf("2026-07-18")).toBe("2026-07-13"); // Saturday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday
    expect(mondayOf("2026-07-19")).toBe("2026-07-13"); // Sunday
  });

  it("bucketWeeks pools rates as Σnum/Σden", () => {
    const weeks = bucketWeeks(
      [
        { day: "2026-07-06", num: 2, den: 10, value: 0.2 },
        { day: "2026-07-08", num: 3, den: 40, value: 0.075 },
        { day: "2026-07-13", num: 1, den: 10, value: 0.1 },
      ],
      "rate",
    );
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-07-06", "2026-07-13"]);
    expect(weeks[0].value).toBeCloseTo(5 / 50);
    expect(weeks[0].days).toBe(2);
  });

  it("session conversion reads as stable-or-better (no false decline)", () => {
    const a = analyzeSeries(conv, "up");
    expect(a.baseline).not.toBeNull();
    expect(a.state).not.toBe("insufficient");
    expect(a.state).not.toBe("declining");
    console.log("[conv] state:", a.state, "reasons:", a.reasons,
      "cl:", (a.baseline!.cl * 100).toFixed(2) + "%",
      "limits:", (a.baseline!.lcl * 100).toFixed(2), "…", (a.baseline!.ucl * 100).toFixed(2),
      "run:", a.run, "driftPct:", a.driftPct.toFixed(1));
  });

  it("no-result rate reads as improving (down is good, and it fell 17%→5%)", () => {
    const a = analyzeSeries(noResult, "down");
    expect(a.state).toBe("improving");
    console.log("[noResult] state:", a.state, "reasons:", a.reasons,
      "cusumDown last:", a.cusumDown[a.cusumDown.length - 1].toFixed(4),
      "h:", a.h.toFixed(4), "downCross:", a.cusumDownCross, "run:", a.run);
  });

  it("orders do not read as declining on this data", () => {
    const a = analyzeSeries(orders, "up");
    expect(a.state).not.toBe("declining");
    console.log("[orders] state:", a.state, "reasons:", a.reasons, "run:", a.run);
  });

  it("the slow-drift blind spot fires CUSUM without any single-week alarm", () => {
    // Synthetic: stable baseline then −2.5%/week for 7 weeks (the design case).
    const vals = [2.10, 2.04, 2.12, 2.05, 2.13, 2.06, 2.11, 2.05, 2.00, 1.95, 1.91, 1.85, 1.80, 1.75];
    const a = analyzeSeries(vals, "up");
    const wowMax = Math.max(...a.wow.filter((v): v is number => v != null).map(Math.abs));
    expect(wowMax).toBeLessThan(5); // no point alarm would ever fire
    expect(a.state).toBe("declining");
    expect(a.reasons.length).toBeGreaterThan(0);
    console.log("[drift] state:", a.state, "reasons:", a.reasons, "downCross:", a.cusumDownCross);
  });

  it("short history is honest", () => {
    expect(analyzeSeries([1, 2, 3], "up").state).toBe("insufficient");
  });

  it("rolling7 aligns and averages", () => {
    const r = rolling7([7, 7, 7, 7, 7, 7, 7, 14]);
    expect(r[5]).toBeNull();
    expect(r[6]).toBe(7);
    expect(r[7]).toBeCloseTo(8);
  });
});
