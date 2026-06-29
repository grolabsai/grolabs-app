#!/usr/bin/env node
/**
 * B1 emulator — reset. Clears all synthetic rows for the test instance so a
 * re-run is deterministic. Only ever touches instance 99999 (the reserved test
 * instance) — never real tenant data.
 *
 *   npm run emulate:reset
 */
import { db, INSTANCE_ID } from "./db.mjs";

for (const table of ["analytics_event", "query_log", "metric_daily"]) {
  const { error } = await db.from(table).delete().eq("instance_id", INSTANCE_ID);
  if (error) {
    console.error(`✗ reset ${table} failed:`, error.message);
    process.exit(1);
  }
}
console.log(`✓ reset: cleared instance ${INSTANCE_ID} (analytics_event, query_log, metric_daily)`);
