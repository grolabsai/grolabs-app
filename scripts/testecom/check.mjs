#!/usr/bin/env node
/**
 * TestEcomSite outcome assertions — the server side of the SDK test pair.
 *
 * TestEcomSite (grolabsai/TestEcomSite) GENERATES shopper journeys through the
 * public APIs, exactly like a customer integration — it holds no database
 * credentials, so it cannot assert what landed. THIS script (service-role,
 * emulator-check pattern) verifies the outcomes: order rows, cart entity
 * states, identity stitching, and the cross-day pair.
 *
 *   # 1. generate (from the TestEcomSite repo):
 *   GROLABS_INSTANCE_ID=99999 npm run scenario all
 *   GROLABS_INSTANCE_ID=99999 npm run scenario day1     # (+ day2 on a later day)
 *   # 2. assert (from this repo):
 *   npm run testecom:check
 *
 * Scope: instance TES_INSTANCE_ID (default 99999 — the synthetic instance;
 * emulator resets wipe it, including these rows), orders with the `tes-`
 * prefix created in the last TES_SINCE_HOURS (default 12).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Missing Supabase env — run via: node --env-file=.env.local scripts/testecom/check.mjs");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const INSTANCE = Number(process.env.TES_INSTANCE_ID ?? "99999");
const SINCE = new Date(Date.now() - Number(process.env.TES_SINCE_HOURS ?? "12") * 3600_000).toISOString();

// order_id prefix → expected outcome. `crossDay` rows are asserted only when present
// (day2 may legitimately not have run yet).
const EXPECTED_ORDERS = [
  { prefix: "tes-anon-convert-",         amount: 29.9,  qty: 1, loggedIn: false },
  { prefix: "tes-login-convert-",        amount: 55.5,  qty: 3, loggedIn: true  },
  { prefix: "tes-login-remove-convert-", amount: 82.24, qty: 2, loggedIn: true  },
  { prefix: "tes-xday-anon-",            amount: 24,    qty: 2, loggedIn: false, crossDay: true, optional: true },
  { prefix: "tes-xday-logged-",          amount: 42,    qty: 2, loggedIn: true,  crossDay: true, optional: true },
  { prefix: "tes-full-funnel-",         amount: 18.5,  qty: 1, loggedIn: true,  optional: true }, // needs a seeded store (testecom:seed)
];
// The two abandon scenarios leave carts OPEN with these unit counts.
const EXPECTED_OPEN_QTYS = [3, 1];

const { data: orders, error: oErr } = await db
  .from("sales_order")
  .select("order_id, amount, total_quantity, account_id, cart_id, created_at")
  .eq("instance_id", INSTANCE).like("order_id", "tes-%").gte("created_at", SINCE);
if (oErr) { console.error("✗ read sales_order:", oErr.message); process.exit(1); }

const { data: carts, error: cErr } = await db
  .from("cart")
  .select("cart_id, status, total_quantity, created_at, last_event_at")
  .eq("instance_id", INSTANCE).gte("last_event_at", SINCE).not("cart_id", "like", "emu-cart-%");
if (cErr) { console.error("✗ read cart:", cErr.message); process.exit(1); }
const cartById = new Map((carts ?? []).map((c) => [c.cart_id, c]));

let pass = 0, fail = 0, skip = 0;
const row = (ok, name, detail) => {
  ok === null ? skip++ : ok ? pass++ : fail++;
  console.log(`  ${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
};

console.log(`\n  TestEcomSite outcomes — instance ${INSTANCE}, since ${SINCE.slice(0, 16)}Z\n`);

for (const e of EXPECTED_ORDERS) {
  const o = (orders ?? []).find((x) => x.order_id.startsWith(e.prefix));
  const name = e.prefix.replace(/^tes-|-$/g, "");
  if (!o) {
    row(e.optional ? null : false, `order ${name}`, e.optional ? "not run (day2 pending?)" : "MISSING");
    continue;
  }
  const cart = cartById.get(o.cart_id);
  const checks = [
    [Number(o.amount) === e.amount, `amount ${o.amount} (want ${e.amount})`],
    [o.total_quantity === e.qty, `qty ${o.total_quantity} (want ${e.qty})`],
    [(o.account_id != null) === e.loggedIn, `account_id ${o.account_id ? "present" : "absent"} (want ${e.loggedIn ? "present" : "absent"})`],
    [cart?.status === "completed", `cart ${cart ? cart.status : "MISSING"} (want completed)`],
  ];
  if (e.crossDay && cart) {
    const opened = cart.created_at.slice(0, 10), ordered = o.created_at.slice(0, 10);
    checks.push([opened < ordered, `opened ${opened} vs ordered ${ordered} (want cross-day)`]);
  }
  const bad = checks.filter(([ok]) => !ok);
  row(bad.length === 0, `order ${name}`, bad.length ? bad.map(([, d]) => d).join("; ") : `$${o.amount}, ${o.total_quantity}u, cart completed${e.crossDay ? ", cross-day" : ""}`);
}

// ── search tier (only when the search-funnel scenarios ran in the window) ──
const { data: searches } = await db
  .from("query_log")
  .select("query, total_hits, is_committed, query_uid")
  .eq("instance_id", INSTANCE).gte("created_at", SINCE);
const committed = (searches ?? []).filter((q) => q.is_committed !== false);
if (committed.length === 0) {
  row(null, "search tier", "no committed searches in window (search-funnel not run)");
} else {
  const withHits = committed.filter((q) => (q.total_hits ?? 0) > 0);
  const zeroHits = committed.filter((q) => q.total_hits === 0);
  row(withHits.length > 0, "committed search with hits", `${withHits.length} (real index answered)`);
  row(zeroHits.length > 0, "committed zero-hit search", `${zeroHits.length} (feeds no_result_rate)`);
  const uids = new Set(committed.map((q) => q.query_uid).filter(Boolean));
  const { data: clicks } = await db
    .from("analytics_event").select("query_uid, position")
    .eq("instance_id", INSTANCE).eq("event_type", "click").gte("created_at", SINCE);
  const attributedClicks = (clicks ?? []).filter((c) => c.query_uid && uids.has(c.query_uid));
  row(attributedClicks.length > 0, "click attributed to a search", `${attributedClicks.length} click(s) carry a matching query_uid`);
  const { data: orderEvents } = await db
    .from("analytics_event").select("order_id, query_uid")
    .eq("instance_id", INSTANCE).eq("event_name", "Completed order").gte("created_at", SINCE);
  const attributedOrders = (orderEvents ?? []).filter((o) => o.query_uid);
  row(attributedOrders.length > 0, "order attributed to a search", `${attributedOrders.length} (search→purchase numerator)`);
}

const open = (carts ?? []).filter((c) => c.status === "open");
for (const qty of EXPECTED_OPEN_QTYS) {
  const hit = open.find((c) => c.total_quantity === qty);
  row(!!hit, `open cart with ${qty} unit(s)`, hit ? `${hit.cart_id.slice(0, 8)}… stays recoverable` : `none among ${open.length} open cart(s)`);
}

console.log(`\n  ${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} pass, ${fail} fail${skip ? `, ${skip} skipped` : ""}\n`);
process.exit(fail === 0 ? 0 : 1);
