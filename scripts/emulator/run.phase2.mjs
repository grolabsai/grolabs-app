#!/usr/bin/env node
/**
 * B1 emulator — Phase 2 push (Meili-aware).
 *
 * For each search it reads the REAL response: captures metadata.queryUid and the
 * returned hits. For a "click" search it clicks the TOP hit (position 0) with
 * that query_uid; for an "order" search it also fires a Completed order tagged
 * with the query_uid (so search→purchase attributes). Miss searches (no hits)
 * get no click/order.
 *
 *   npm run emulate:push:phase2     (requires a seeded inst_99999 + dev server)
 *   node scripts/emulator/run.phase2.mjs [--url <base>] [--yes-prod]
 */
import { INSTANCE_ID, ORIGIN, SEARCHES } from "./scenario.phase2.mjs";

const argv = process.argv.slice(2);
const urlFlag = argv.indexOf("--url");
const baseUrl = ((urlFlag >= 0 ? argv[urlFlag + 1] : null) || "http://localhost:3030").replace(/\/+$/, "");
const yesProd = argv.includes("--yes-prod");
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
if (!isLocal && !yesProd) {
  console.error(`✗ Refusing non-localhost URL without --yes-prod: ${baseUrl}`);
  process.exit(1);
}

const HEADERS = { "Content-Type": "application/json", Origin: ORIGIN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(path, body) {
  const res = await fetch(baseUrl + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`▶ emulator (Phase 2) → ${baseUrl}  (instance ${INSTANCE_ID})`);
  let hits = 0, misses = 0, clicks = 0, orders = 0, errs = 0;

  for (const s of SEARCHES) {
    const { status, json } = await postJson("/api/v1/search", {
      instance_id: INSTANCE_ID, query: s.query, limit: 20, offset: 0,
      userId: s.bid, accountId: null, committed: true,
    });
    if (status !== 200) {
      errs++;
      if (errs <= 3) console.log(`  search ${status} for "${s.query}" — is inst_${INSTANCE_ID} seeded? (npm run emulate:seed)`);
      await sleep(40);
      continue;
    }
    const queryUid = json?.metadata?.queryUid || "";
    const resultHits = Array.isArray(json?.hits) ? json.hits : [];
    resultHits.length > 0 ? hits++ : misses++;

    if (s.click && resultHits.length > 0 && queryUid) {
      const top = resultHits[0]?.document || {};
      const objectId = String(top.woocommerce_id ?? top.id ?? "");
      await postJson("/api/v1/events", {
        instance_id: INSTANCE_ID, eventType: "click", eventName: "Search Result Clicked",
        objectId, objectName: top.name || objectId, userId: s.bid,
        queryUid, indexUid: json?.metadata?.indexUid || "", position: 0,
      });
      clicks++;

      if (s.order) {
        await postJson("/api/v1/events", {
          instance_id: INSTANCE_ID, eventType: "conversion", eventName: "Completed order",
          objectId, objectName: top.name || objectId, userId: s.bid,
          queryUid, position: 0, orderId: `p2-o-${orders + 1}`, cartId: `p2-cart-${s.bid}`,
        });
        orders++;
      }
    }
    await sleep(40);
  }

  console.log(`  searches: ${SEARCHES.length} (hit:${hits} miss:${misses} err:${errs}) · clicks:${clicks} · orders:${orders}`);
  if (errs > 0) {
    console.error("✗ search errors — seed the index (npm run emulate:seed) and ensure the dev server is up.");
    process.exit(1);
  }
  console.log("✓ Phase 2 push complete. Diff: EMU_SCENARIO=./scenario.phase2.mjs npm run emulate:check  (or npm run emulate:check:phase2)");
}

main().catch((e) => { console.error("✗", e?.message || e); process.exit(1); });
