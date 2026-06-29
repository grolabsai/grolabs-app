/**
 * B1 emulator — Phase 2 scenario (search-quality JOIN KPIs).
 *
 * Phase 2 seeds a tiny Meilisearch index (inst_99999) so searches return REAL
 * hits + a real query_uid. That unlocks the metrics Phase 1 can't:
 *   no_result_rate (real fraction), search_ctr, no_click_rate,
 *   time_to_first_click_median, search_to_purchase.
 *
 * The runner (run.phase2.mjs) is Meili-aware: it reads each search response,
 * and for a "click" search fires a click on the TOP hit (index 0 → position 0)
 * carrying the real query_uid; for an "order" search it also fires a Completed
 * order tagged with that query_uid (so search→purchase attributes).
 *
 * Ordering-independent by design: expectations depend only on hit/miss and
 * click/no-click COUNTS (which the runner controls), never on Meili's ranking.
 *
 * ⚠️ STAGED — not yet run. Requires MEILISEARCH_HOST + MEILISEARCH_MASTER_KEY in
 * .env.local and a seeded index (npm run emulate:seed). Assumes the GroLabs Meili
 * tier returns metadata.queryUid (the plugin's attribution already relies on it).
 */

export const INSTANCE_ID = 99999;
export const ORIGIN = "http://test.local";
export const INDEX_UID = `inst_${INSTANCE_ID}`; // matches indexUidFor() in src/lib/search/types.ts

// ── Seed catalog (12 products) ──────────────────────────────────────────────
// Minimal-but-valid RreSearchDocument shape. Names carry distinct, literal terms
// so hit-queries match exactly one and miss-queries match none.
const NAMES = [
  "Dog Food Premium", "Cat Food Deluxe", "Leash Nylon", "Puppy Treats",
  "Litter Box", "Collar Leather", "Chew Toy", "Pet Bed",
  "Shampoo Oatmeal", "Food Bowl", "Grooming Brush", "Vitamins Daily",
];
export const PRODUCTS = NAMES.map((name, i) => {
  const id = 9001 + i;
  return {
    id, instance_id: INSTANCE_ID, woocommerce_id: id,
    name, slug: name.toLowerCase().replace(/\s+/g, "-"),
    description: name, short_description: name,
    url: `https://test.local/p/${id}`, image_url: null, thumbnail_url: null,
    categories: ["Test"], category_ids: [1], tags: [], brand: null,
    price: 1000 + i, in_stock: true, variants: [],
    // The route's variant-matcher reads variation_summary.type; "simple" → it
    // returns null (no variant highlighted) without throwing.
    variation_summary: { type: "simple", in_stock_summary: { any_in_stock: true } },
  };
});

// ── Searches: 12 hit + 8 miss = 20 committed ────────────────────────────────
const HIT_TERMS  = ["dog", "cat", "leash", "treats", "litter", "collar",
                    "toy", "bed", "shampoo", "bowl", "brush", "vitamins"]; // each matches a product
const MISS_TERMS = ["aquarium", "birdcage", "saddle", "ferret",
                    "reptile", "hamster", "parrot", "turtle"];             // match nothing
const bid = (i) => `p2-b${String((i % 6) + 1).padStart(2, "0")}`;

// Of the 12 hits: first 6 get a click; of those 6, first 3 also order.
export const SEARCHES = [
  ...HIT_TERMS.map((query, i) => ({
    bid: bid(i), query, hit: true, click: i < 6, order: i < 3,
  })),
  ...MISS_TERMS.map((query, i) => ({
    bid: bid(i + 12), query, hit: false, click: false, order: false,
  })),
];

// ── EXPECTED (Phase 2 KPI sheet) ────────────────────────────────────────────
export const EXPECTED = [
  { key: "search_volume",        value: 20,   tol: 0,    note: "20 committed searches" },
  { key: "zero_result_searches", value: 8,    tol: 0,    note: "8 miss queries" },
  { key: "no_result_rate",       value: 0.4,  tol: 0,    note: "8 miss / 20 — a REAL fraction now" },
  { key: "search_ctr",           value: 0.5,  tol: 0,    note: "6 clicked / 12 with results" },
  { key: "no_click_rate",        value: 0.5,  tol: 0,    note: "6 no-click / 12 with results" },
  { key: "search_to_purchase",   value: 0.15, tol: 0,    note: "3 attributed orders / 20 searches" },
  { key: "avg_click_position",   value: 0.0,  tol: 0,    note: "always click the top hit" },
  { key: "mrr",                  value: 1.0,  tol: 0,    note: "1/(0+1) for every click" },
  { key: "time_to_first_click_median", present: true,   note: "6 samples; small seconds" },
];
