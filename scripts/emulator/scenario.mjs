/**
 * B1 Conversion-Measurement — synthetic traffic scenario (Phase 1).
 *
 * A KNOWN, hand-interpretable dataset pushed through the REAL APIs
 * (/api/v1/search + /api/v1/events) against the reserved test instance 99999
 * (storefront_domains = [test.local]). Paired with EXPECTED below so the whole
 * chain can be validated round-trip: input → API → storage → rollup → expected.
 *
 * Phase 1 deliberately uses NO Meilisearch index for 99999, so:
 *   - Conversion / position / grain KPIs are FULLY deterministic (events API is
 *     entirely under our control).
 *   - Searches still exercise the /api/v1/search → query_log path, but every
 *     search returns no hits (no index) → no_result_rate is degenerately 1.0
 *     and the search↔click JOIN metrics (CTR, no-click, time-to-click,
 *     search→purchase) are deferred to Phase 2 (seed a tiny 99999 index).
 *
 * All events land at created_at = now() (the routes stamp it), so the scenario
 * is single-day: today, instance 99999.
 */

export const INSTANCE_ID = 99999;
export const ORIGIN = "http://test.local";

// 10 shoppers (persistent browser ids). First 3 are "logged in" (account_id).
export const SHOPPERS = [
  { bid: "emu-b01", account: "emu-acct-A" },
  { bid: "emu-b02", account: "emu-acct-B" },
  { bid: "emu-b03", account: "emu-acct-C" },
  { bid: "emu-b04", account: null },
  { bid: "emu-b05", account: null },
  { bid: "emu-b06", account: null },
  { bid: "emu-b07", account: null },
  { bid: "emu-b08", account: null },
  { bid: "emu-b09", account: null },
  { bid: "emu-b10", account: null },
];
const acct = (bid) => SHOPPERS.find((s) => s.bid === bid)?.account ?? null;

// ── SEARCHES (committed) ────────────────────────────────────────────────────
// 25 committed searches spread across shoppers. No 99999 index → all 502 / zero
// hits (Phase 1). Exercises the search→query_log path incl. user_id + account_id.
const QUERIES = ["dog food", "cat toy", "leash", "puppy treats", "litter box"];
export const SEARCHES = Array.from({ length: 25 }, (_, i) => {
  const bid = SHOPPERS[i % SHOPPERS.length].bid;
  return { bid, accountId: acct(bid), query: QUERIES[i % QUERIES.length] };
});

// ── CLICKS ──────────────────────────────────────────────────────────────────
// 10 clicks, positions chosen so avg = 2.0. (query_uid is fabricated — Phase 1
// has no real search lineage; avg_click_position/mrr don't need the join.)
const CLICK_POSITIONS = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4];
export const CLICKS = CLICK_POSITIONS.map((pos, i) => {
  const bid = SHOPPERS[i].bid;
  return {
    bid, accountId: acct(bid),
    eventType: "click", eventName: "Search Result Clicked",
    objectId: `emu-p${(i % 10) + 1}`, position: pos, queryUid: `emu-qe-${i}`,
  };
});

// ── CONVERSIONS ─────────────────────────────────────────────────────────────
const mkConv = (bid, eventName, extra = {}) => ({
  bid, accountId: acct(bid), eventType: "conversion", eventName,
  objectId: extra.objectId ?? `emu-p${extra.p ?? 1}`, cartId: `emu-cart-${bid}`,
  ...extra,
});

// 20 add-to-cart (alternating PLP/PDP), 2 per shopper.
export const ADDS = SHOPPERS.flatMap((s, i) => [
  mkConv(s.bid, "Added to cart from PLP", { p: (i % 10) + 1 }),
  mkConv(s.bid, "Added to cart from PDP", { p: ((i + 5) % 10) + 1 }),
]);

// 10 checkouts — one per shopper.
export const CHECKOUTS = SHOPPERS.map((s, i) =>
  mkConv(s.bid, "Proceeded to check out", { p: (i % 10) + 1 })
);

// 8 orders from 4 DISTINCT shoppers (b01..b04), 2 each → user/session conversion
// denominator 10, numerator 4. (No queryUid → search→purchase stays 0 in Phase 1.)
// 8 orders, each one line of value $50 × 2 units → total_sales 400, orders 8,
// aov 50, avg_items_per_order 2.
export const ORDERS = ["emu-b01", "emu-b02", "emu-b03", "emu-b04"].flatMap((bid, i) => [
  mkConv(bid, "Completed order", { p: (i % 10) + 1, orderId: `emu-o${i * 2 + 1}`, value: 50, qty: 2 }),
  mkConv(bid, "Completed order", { p: ((i + 1) % 10) + 1, orderId: `emu-o${i * 2 + 2}`, value: 50, qty: 2 }),
]);

// 4 cart removals — exercises the cart_remove path (no KPI yet beyond cart value).
export const REMOVES = ["emu-b05", "emu-b06", "emu-b07", "emu-b08"].map((bid, i) => ({
  bid, accountId: acct(bid), eventType: "cart_remove", eventName: "Removed from cart",
  objectId: `emu-p${i + 1}`, cartId: `emu-cart-${bid}`,
}));

export const ALL_EVENTS = [...CLICKS, ...ADDS, ...CHECKOUTS, ...ORDERS, ...REMOVES];

// ── EXPECTED KPIs (the interpretation sheet) ────────────────────────────────
// What metric_daily for instance 99999 (today) MUST show. tol = absolute
// tolerance on `value`. `absent: true` = Phase 2 (should produce no row yet).
const mrr =
  CLICK_POSITIONS.reduce((a, p) => a + 1 / (p + 1), 0) / CLICK_POSITIONS.length;

export const EXPECTED = [
  { key: "search_volume",        value: 25,   tol: 0,      note: "25 committed searches pushed" },
  { key: "zero_result_searches", value: 25,   tol: 0,      note: "no 99999 index → all zero-hit" },
  { key: "no_result_rate",       value: 1.0,  tol: 0,      note: "DEGENERATE (Phase 1, no index); Phase 2 makes it a real fraction" },
  { key: "avg_click_position",   value: 2.0,  tol: 0,      note: "Σpos 20 / 10 clicks" },
  { key: "mrr",                  value: mrr,  tol: 0.0005, note: "mean 1/(pos+1)" },
  { key: "cart_to_checkout",     value: 0.5,  tol: 0,      note: "10 checkouts / 20 adds" },
  { key: "checkout_to_purchase", value: 0.8,  tol: 0,      note: "8 orders / 10 checkouts" },
  { key: "search_to_purchase",   value: 0.0,  tol: 0,      note: "orders have no queryUid in Phase 1" },
  { key: "session_conversion",   value: 0.4,  tol: 0,      note: "4 converting sessions / 10" },
  { key: "user_conversion",      value: 0.4,  tol: 0,      note: "4 purchasing users / 10 active" },
  { key: "total_sales",          value: 400,  tol: 0,      note: "8 order lines × $50" },
  { key: "orders",               value: 8,    tol: 0,      note: "8 distinct order_ids" },
  { key: "aov",                  value: 50,   tol: 0,      note: "$400 / 8 orders" },
  { key: "avg_items_per_order",  value: 2,    tol: 0,      note: "16 units / 8 orders" },
  // Phase 2 (need a real 99999 Meili index for query_uid join):
  { key: "search_ctr",                 absent: true, note: "Phase 2 — needs successful searches" },
  { key: "no_click_rate",              absent: true, note: "Phase 2" },
  { key: "time_to_first_click_median", absent: true, note: "Phase 2" },
];
