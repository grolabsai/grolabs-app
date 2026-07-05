#!/usr/bin/env node
/**
 * TestEcomSite store seed — gives the SDK test instance a real store so the
 * FULL funnel can be emulated: search → hits → click → PDP → cart → order.
 *
 *   1. Product catalog rows (product table) for the 6 demo products — makes
 *      open-cart values EXACT (recompute_cart joins object_id → woocommerce_id)
 *      instead of AOV estimates.
 *   2. Meilisearch index inst_<id> with the same products, in the shape the
 *      /api/v1/search proxy expects (instance_id filterable etc.). Seeded via
 *      the DIRECT Meili connection (MEILISEARCH_HOST + MASTER_KEY in .env.local)
 *      — the prod gateway blocks index management, not search.
 *
 *   node --env-file=.env.local scripts/testecom/seed-store.mjs            # instance 12
 *   TES_INSTANCE_ID=99999 node --env-file=.env.local scripts/testecom/seed-store.mjs
 *   node --env-file=.env.local scripts/testecom/seed-store.mjs --teardown # drop the index only
 *
 * Idempotent: re-running replaces the products and recreates the index.
 * Guarded to the two test instances — refuses anything else.
 */
import { createClient } from "@supabase/supabase-js";
import { Meilisearch } from "meilisearch";

const INSTANCE = Number(process.env.TES_INSTANCE_ID ?? "12");
if (![12, 99999].includes(INSTANCE)) {
  console.error(`✗ refusing instance ${INSTANCE} — this seeder only touches the test instances (12, 99999).`);
  process.exit(1);
}
const INDEX_UID = `inst_${INSTANCE}`;

// Same catalog as TestEcomSite's storefront + scenarios (ids must match).
const PRODUCTS = [
  { id: 1001, name: "Dog food 2 kg",   price: 18.5  },
  { id: 1002, name: "Cat tower",       price: 74.99 },
  { id: 1003, name: "Leash — red",     price: 12.0  },
  { id: 1004, name: "Aquarium filter", price: 29.9  },
  { id: 1005, name: "Bird seed 1 kg",  price: 7.25  },
  { id: 1006, name: "Litter box",      price: 21.0  },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const meiliHost = process.env.MEILISEARCH_HOST;
const meiliKey = process.env.MEILISEARCH_MASTER_KEY;
if (!url || !key || !meiliHost || !meiliKey) {
  console.error("✗ Missing env — run via: node --env-file=.env.local scripts/testecom/seed-store.mjs");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const meili = new Meilisearch({ host: meiliHost, apiKey: meiliKey });
const waitTask = async (t) => { const uid = t?.taskUid ?? t?.uid; if (uid != null) await meili.tasks.waitForTask(uid); };

const teardown = process.argv.includes("--teardown");
try { await waitTask(await meili.deleteIndex(INDEX_UID)); console.log(`  dropped ${INDEX_UID}`); } catch { /* absent */ }
if (teardown) { console.log("✓ teardown done"); process.exit(0); }

// ── catalog rows ─────────────────────────────────────────────────────────────
const ids = PRODUCTS.map((p) => p.id);
const del = await db.from("product").delete().eq("instance_id", INSTANCE).in("woocommerce_id", ids);
if (del.error) { console.error("✗ product delete:", del.error.message); process.exit(1); }
const ins = await db.from("product").insert(PRODUCTS.map((p) => ({
  instance_id: INSTANCE,
  woocommerce_id: p.id,
  product_name: p.name,
  slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  price: p.price,
  is_active: true,
})));
if (ins.error) { console.error("✗ product insert:", ins.error.message); process.exit(1); }
console.log(`  catalog: ${PRODUCTS.length} products upserted for instance ${INSTANCE}`);

// ── search index (proxy-compatible document shape) ──────────────────────────
await waitTask(await meili.createIndex(INDEX_UID, { primaryKey: "id" }));
const index = meili.index(INDEX_UID);
await waitTask(await index.updateSettings({
  // instance_id MUST be filterable — the /api/v1/search proxy always filters on it.
  filterableAttributes: ["instance_id", "category_ids", "in_stock", "price"],
  searchableAttributes: ["name", "categories", "description"],
}));
await waitTask(await index.addDocuments(PRODUCTS.map((p) => ({
  id: p.id, instance_id: INSTANCE, woocommerce_id: p.id,
  name: p.name, slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  description: p.name, short_description: p.name,
  url: `https://www.grolabs.io/p/${p.id}`, image_url: null, thumbnail_url: null,
  categories: ["Pets"], category_ids: [1], tags: [], brand: null,
  price: p.price, in_stock: true, variants: [],
  variation_summary: { type: "simple", in_stock_summary: { any_in_stock: true } },
}))));
const total = await index.getDocuments({ limit: 0 }).then((r) => r.total ?? "?");
console.log(`  search: ${INDEX_UID} ready (${PRODUCTS.length} docs; index reports total=${total})`);
console.log(`✓ instance ${INSTANCE} is a full store — searches now return real hits.`);
