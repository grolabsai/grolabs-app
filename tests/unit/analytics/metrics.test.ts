import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

import { MATERIALIZED_METRIC_KEYS, METRICS, METRIC_BY_KEY } from "@/lib/analytics/metrics";

/**
 * The catalog (metrics.ts) is metadata over the metric_daily_source SQL view —
 * `key` MUST match `metric_key` there, and `materialized` MUST mean "the view
 * emits it". Nothing enforces that at build time, so this test does two things:
 *   1. internal catalog invariants (unique keys, materialized ⟺ buildable now,
 *      materialized rates carry num/den labels, deferred rows say why), and
 *   2. an anti-drift check: parse the LATEST migration that (re)defines
 *      metric_daily_source and require its emitted metric_key set to equal
 *      MATERIALIZED_METRIC_KEYS exactly.
 */

const GRAINS = ["search", "intent", "click", "event", "session", "journey", "user"];

/** metric_key literals from the latest metric_daily_source migration. */
function viewMetricKeys(): Set<string> {
  const dir = path.resolve(__dirname, "../../../supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /create\s+or\s+replace\s+view\s+(public\.)?metric_daily_source/i.test(
        readFileSync(path.join(dir, f), "utf8"),
      ),
    );
  expect(files.length).toBeGreaterThan(0);
  const sql = readFileSync(path.join(dir, files[files.length - 1]), "utf8");
  // A key appears as `'key'::text AS metric_key` (first arm) or as
  // `'key'::text, '<grain>'::text` (every UNION ALL arm).
  const re = new RegExp(
    `'([a-z0-9_]+)'::text(?:\\s+AS\\s+metric_key|,\\s*'(?:${GRAINS.join("|")})'::text)`,
    "gi",
  );
  const keys = new Set<string>();
  for (const m of sql.matchAll(re)) keys.add(m[1]);
  return keys;
}

describe("metric catalog invariants", () => {
  it("has unique keys", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("materialized ⟺ buildable 'now'", () => {
    for (const m of METRICS) {
      expect(m.materialized, m.key).toBe(m.buildable === "now");
    }
  });

  it("materialized rate metrics carry numerator/denominator labels", () => {
    for (const m of METRICS.filter((m) => m.materialized && m.kind === "rate")) {
      expect(m.numeratorLabel, m.key).toBeTruthy();
      expect(m.denominatorLabel, m.key).toBeTruthy();
    }
  });

  it("non-materialized metrics say why", () => {
    for (const m of METRICS.filter((m) => !m.materialized)) {
      expect(m.blockedReason, m.key).toBeTruthy();
    }
  });

  it("METRIC_BY_KEY covers every metric", () => {
    for (const m of METRICS) expect(METRIC_BY_KEY[m.key]).toBe(m);
  });
});

describe("catalog ↔ metric_daily_source view", () => {
  it("the latest view migration emits exactly the materialized keys", () => {
    expect([...viewMetricKeys()].sort()).toEqual([...MATERIALIZED_METRIC_KEYS].sort());
  });

  it("newly-materialized PDP + sales keys are present", () => {
    for (const key of ["click_to_pdp", "pdp_views", "pdp_to_cart", "total_sales", "orders", "aov", "avg_items_per_order"]) {
      expect(MATERIALIZED_METRIC_KEYS, key).toContain(key);
    }
  });
});
