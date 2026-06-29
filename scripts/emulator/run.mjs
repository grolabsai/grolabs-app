#!/usr/bin/env node
/**
 * B1 Conversion-Measurement — synthetic traffic emulator (push step).
 *
 * Pushes the KNOWN scenario in scenario.mjs through the REAL APIs
 * (/api/v1/search + /api/v1/events) exactly like the WP plugin does, so the
 * whole chain can be validated round-trip: input → API → storage → rollup →
 * EXPECTED. This is the "generate the traffic and watch the rows appear" tool.
 *
 * ┌─ SAFETY ──────────────────────────────────────────────────────────────────┐
 * │ Writes go to the reserved test instance 99999 (storefront_domains =        │
 * │ [test.local]). Against a local dev server they hit your dev DB. Against a   │
 * │ deployed URL they write REAL rows to that environment's DB (still scoped    │
 * │ to instance 99999). The script refuses any non-localhost URL unless you     │
 * │ pass --yes-prod, to prevent accidental writes to production.                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   # against a local `npm run dev` (default):
 *   npm run emulate:push
 *   node scripts/emulator/run.mjs
 *
 *   # against a specific / deployed URL (opt in explicitly):
 *   node scripts/emulator/run.mjs --url https://app.grolabs.ai --yes-prod
 *
 * Full repeatable cycle (reset → push → check):  npm run emulate
 * (the dev server must already be running for the push to reach it).
 */
import { INSTANCE_ID, ORIGIN, SEARCHES, ALL_EVENTS } from "./scenario.mjs";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlFlag = argv.indexOf("--url");
const BASE = (urlFlag >= 0 ? argv[urlFlag + 1] : argv[0]?.startsWith("--") ? null : argv[0]) || "http://localhost:3030";
const baseUrl = BASE.replace(/\/+$/, "");
const yesProd = argv.includes("--yes-prod");

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
if (!isLocal && !yesProd) {
  console.error(
    `✗ Refusing to push to a non-localhost URL without --yes-prod:\n    ${baseUrl}\n` +
    `  This writes real rows (instance ${INSTANCE_ID}) to that environment's DB.`
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { "Content-Type": "application/json", Origin: ORIGIN };

async function post(path, body) {
  try {
    const res = await fetch(baseUrl + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
    return res.status;
  } catch (e) {
    return `ERR ${e?.message || e}`;
  }
}

async function main() {
  console.log(`▶ emulator → ${baseUrl}  (instance ${INSTANCE_ID}, origin ${ORIGIN})`);

  // SEARCHES — /api/v1/search. 502 is EXPECTED in Phase 1 (no 99999 index); the
  // query_log row still logs, so it's success-for-our-purposes.
  let s2xx = 0, s502 = 0, sErr = 0;
  for (const s of SEARCHES) {
    const status = await post("/api/v1/search", {
      instance_id: INSTANCE_ID, query: s.query, limit: 20, offset: 0,
      userId: s.bid, accountId: s.accountId, committed: true,
    });
    if (status === 200) s2xx++;
    else if (status === 502) s502++;
    else { sErr++; if (sErr <= 3) console.log(`  search unexpected: ${status}`); }
    await sleep(40); // well under 600/min
  }
  console.log(`  searches: ${SEARCHES.length} sent  (200:${s2xx} 502:${s502} other:${sErr})`);

  // EVENTS — /api/v1/events (un-gated, no rate limit).
  let e2xx = 0, eErr = 0;
  for (const ev of ALL_EVENTS) {
    const status = await post("/api/v1/events", {
      instance_id: INSTANCE_ID,
      eventType: ev.eventType, eventName: ev.eventName,
      objectId: ev.objectId, objectName: ev.objectId,
      userId: ev.bid, accountId: ev.accountId,
      ...(ev.position != null ? { position: ev.position } : {}),
      ...(ev.queryUid ? { queryUid: ev.queryUid } : {}),
      ...(ev.orderId ? { orderId: ev.orderId } : {}),
      ...(ev.cartId ? { cartId: ev.cartId } : {}),
      ...(ev.value != null ? { value: ev.value } : {}),
      ...(ev.qty != null ? { quantity: ev.qty } : {}),
    });
    if (status === 200) e2xx++;
    else { eErr++; if (eErr <= 5) console.log(`  event non-200: ${status} (${ev.eventName})`); }
    await sleep(15);
  }
  console.log(`  events:   ${ALL_EVENTS.length} sent  (200:${e2xx} other:${eErr})`);

  if (sErr > 0 || eErr > 0) {
    console.error("✗ some requests failed — is the dev server up? (npm run dev)");
    process.exit(1);
  }
  console.log("✓ push complete. Run `npm run emulate:check` to diff vs EXPECTED.");
}

main();
