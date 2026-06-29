#!/usr/bin/env node
/**
 * B1 emulator — check. Materializes today's rollup (refresh_metric_daily) and
 * diffs metric_daily for instance 99999 against the EXPECTED sheet of a scenario.
 * Prints a PASS/FAIL table and exits non-zero on any mismatch (CI-able).
 *
 *   npm run emulate:check            # Phase 1 (./scenario.mjs)
 *   npm run emulate:check:phase2     # Phase 2 (./scenario.phase2.mjs)
 *
 * Scenario selected by EMU_SCENARIO (default ./scenario.mjs). EXPECTED entries:
 *   { key, value, tol }   — assert value within tol
 *   { key, absent: true } — assert NO row (not yet materialized)
 *   { key, present: true } — assert a row exists (value not checked)
 */
import { db, TODAY, INSTANCE_ID } from "./db.mjs";

const scenarioFile = process.env.EMU_SCENARIO || "./scenario.mjs";
const { EXPECTED } = await import(scenarioFile);

const { error: rErr } = await db.rpc("refresh_metric_daily", { p_day: TODAY });
if (rErr) { console.error("✗ refresh_metric_daily failed:", rErr.message); process.exit(1); }

const { data, error } = await db
  .from("metric_daily")
  .select("metric_key, value, numerator, denominator, sample_size")
  .eq("instance_id", INSTANCE_ID)
  .eq("day", TODAY);
if (error) { console.error("✗ read metric_daily failed:", error.message); process.exit(1); }
const got = Object.fromEntries((data ?? []).map((r) => [r.metric_key, r]));

let pass = 0, fail = 0;
const rows = [];
for (const e of EXPECTED) {
  const row = got[e.key];
  let ok, exp, act;
  if (e.absent) {
    ok = !row; exp = "absent"; act = row ? `value ${Number(row.value)}` : "absent";
  } else if (e.present) {
    ok = !!row; exp = "present"; act = row ? `value ${Number(row.value).toFixed(4)} (n=${row.sample_size})` : "(missing)";
  } else {
    const actual = row ? Number(row.value) : null;
    ok = actual != null && Math.abs(actual - e.value) <= (e.tol ?? 0);
    exp = String(e.value); act = actual == null ? "(missing)" : actual.toFixed(4);
  }
  ok ? pass++ : fail++;
  rows.push([ok, e.key, exp, act]);
}

const w = Math.max(...rows.map((r) => r[1].length));
console.log(`\n  metric_daily — instance ${INSTANCE_ID}, day ${TODAY}  (${scenarioFile})\n`);
for (const [ok, key, exp, act] of rows) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${key.padEnd(w)}  expected ${String(exp).padEnd(16)} got ${act}`);
}
console.log(`\n  ${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
