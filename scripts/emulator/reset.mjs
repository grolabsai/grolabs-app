#!/usr/bin/env node
/**
 * B1 emulator — reset. Clears all synthetic rows for the test instance so a
 * re-run is deterministic. Only ever touches instance 99999 (the reserved test
 * instance) — never real tenant data.
 *
 *   npm run emulate:reset
 */
import { db, INSTANCE_ID } from "./db.mjs";

// sales_order + cart are entities keyed on (instance_id, order_id/cart_id) and
// the event→order bridge never updates created_at on conflict — stale rows from
// a previous run would pin the sales KPIs to the OLD day and break re-runs.
for (const table of ["analytics_event", "query_log", "metric_daily", "sales_order", "cart"]) {
  const { error } = await db.from(table).delete().eq("instance_id", INSTANCE_ID);
  if (error) {
    console.error(`✗ reset ${table} failed:`, error.message);
    process.exit(1);
  }
}
console.log(`✓ reset: cleared instance ${INSTANCE_ID} (analytics_event, query_log, metric_daily, sales_order, cart)`);
