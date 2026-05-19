/**
 * Detect where the connected WooCommerce site stores each "first-class"
 * concept — brand, barcode, cost — and report a structured map back so the
 * user can pick where Scout should READ from and WRITE to.
 *
 * Why this exists: WC stores the same concept in many possible places
 * depending on which plugins/themes are installed. Brand is the canonical
 * example — WC core has Brands (taxonomy `product_brand`), but older sites
 * use plugins like Perfect Brands (`pwb-brand`), YITH (`yith_product_brand`),
 * or just an `attributes[name="Marca"]`. Reading from the wrong place
 * misses data; writing to the wrong place leaves the storefront blank.
 *
 * Strategy:
 *   1. PROBE installed capabilities  — call /products/brands (WC), call
 *      /wp/v2/taxonomies (WP) to enumerate every registered taxonomy.
 *   2. SAMPLE actual products       — fetch one page of products and look
 *      at where data is actually populated today. "Installed" ≠ "populated".
 *   3. REPORT a per-sink scorecard  — for each candidate sink, return
 *      { installed, populated_count } so the user (and any future
 *      auto-pick heuristic) can choose intelligently.
 *
 * No DB writes here, no decision-making — pure read+analysis. The caller
 * persists the report on `instance.integrations_config.woocommerce.field_sinks`.
 */

import {
  getStoreBrands,
  getWpTaxonomies,
  listProductsPage,
  type WooClient,
  type WooProductRaw,
  type WpTaxonomyEntry,
} from "./woocommerce-client";

// ─── Public types ─────────────────────────────────────────────────────────

export type SinkScore = {
  /** Stable id used as the `write_target` value when the user picks. */
  id: string;
  /** Human label for the config UI. */
  label: string;
  /** True when the sink is REACHABLE on this site (taxonomy exists, attribute
   *  name is in use, field is present in the product schema, etc.). */
  installed: boolean;
  /** How many of the sampled products have a non-empty value in this sink.
   *  0 with `installed=true` means "supported but unused so far". */
  populated_count: number;
  /** Optional examples (up to 3) to help the user spot which sink carries
   *  the right value. E.g. for brand: ["Hills", "Nutri Source"]. */
  samples?: string[];
};

export type FieldDetectionReport = {
  detected_at: string;
  sample_size: number;
  /** WC API base + admin keys are out of scope here; just metadata that
   *  helps the user understand the report. */
  meta: {
    wc_brands_endpoint_reachable: boolean;
    wp_taxonomies_reachable: boolean;
    /** Slugs of WP taxonomies linked to the `product` post type that look
     *  brand-like (the detection heuristic, kept here for transparency). */
    brandlike_taxonomies: string[];
  };
  brand: SinkScore[];
  barcode: SinkScore[];
  cost: SinkScore[];
};

// ─── Heuristics ───────────────────────────────────────────────────────────

const BRAND_ATTR_NAMES = ["marca", "brand", "manufacturer", "marka"];
const BARCODE_META_KEYS = [
  "_barcode",
  "barcode",
  "_ean",
  "ean",
  "_upc",
  "upc",
  "_gtin",
  "_wpm_gtin_code",
  "hwp_product_gtin",
];
const COST_META_KEYS = [
  "_cost",
  "cost",
  "_wc_cog_cost",
  "_cogs",
  "_alg_wc_cog_cost",
];

const BRANDLIKE_TAXONOMY_HINTS = [
  /^product[_-]?brand[s]?$/i,
  /^pwb[_-]?brand$/i,
  /^yith[_-]?product[_-]?brand$/i,
];

const SAMPLE_PAGE_SIZE = 50;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function detectFieldSinks(
  client: WooClient,
): Promise<FieldDetectionReport> {
  // 1. Capability probes (parallel — both are cheap)
  const [brandsRes, taxonomiesRes] = await Promise.all([
    getStoreBrands(client),
    getWpTaxonomies(client),
  ]);

  const wcBrandsReachable = brandsRes.ok;
  const wpTaxonomiesReachable = taxonomiesRes.ok;

  const brandlikeTaxonomies = wpTaxonomiesReachable
    ? findBrandlikeTaxonomies(taxonomiesRes.data)
    : [];

  // 2. Sample products (one page — enough to see distribution)
  const sampleRes = await listProductsPage(client, 1, SAMPLE_PAGE_SIZE, "any");
  const sample: WooProductRaw[] = sampleRes.ok ? sampleRes.data : [];

  // 3. Score each candidate sink
  return {
    detected_at: new Date().toISOString(),
    sample_size: sample.length,
    meta: {
      wc_brands_endpoint_reachable: wcBrandsReachable,
      wp_taxonomies_reachable: wpTaxonomiesReachable,
      brandlike_taxonomies: brandlikeTaxonomies,
    },
    brand: scoreBrandSinks(sample, wcBrandsReachable, brandlikeTaxonomies),
    barcode: scoreBarcodeSinks(sample),
    cost: scoreCostSinks(sample),
  };
}

// ─── Brand scoring ────────────────────────────────────────────────────────

function scoreBrandSinks(
  sample: WooProductRaw[],
  wcBrandsReachable: boolean,
  brandlikeTaxonomies: string[],
): SinkScore[] {
  const out: SinkScore[] = [];

  // WC core Brands (taxonomy `product_brand`, exposed as `brands[]` on the
  // product payload). Even if the endpoint is 404, we still report it so
  // the user sees that the official sink doesn't exist on this site.
  const brandsSamples: string[] = [];
  let brandsPop = 0;
  for (const p of sample) {
    const arr = Array.isArray((p as { brands?: unknown }).brands)
      ? ((p as { brands?: Array<{ name?: string }> }).brands ?? [])
      : [];
    if (arr.length > 0) {
      brandsPop += 1;
      const name = arr[0]?.name;
      if (typeof name === "string" && name && brandsSamples.length < 3) {
        brandsSamples.push(name);
      }
    }
  }
  out.push({
    id: "brands",
    label: "WC Brands (core, taxonomy product_brand)",
    installed: wcBrandsReachable,
    populated_count: brandsPop,
    samples: brandsSamples,
  });

  // Plugin taxonomies (Perfect Brands / YITH / Product Brands plugin).
  // These usually DON'T expose their term as a top-level field on the
  // product payload, so `populated_count` will be 0 from the sample — the
  // `installed` flag is the meaningful signal here. We report each
  // detected taxonomy as its own sink so the user can see which one their
  // theme might be reading from.
  for (const tax of brandlikeTaxonomies) {
    // We already accounted for `product_brand` above.
    if (tax === "product_brand") continue;
    out.push({
      id: `taxonomy:${tax}`,
      label: `Taxonomy ${tax} (plugin)`,
      installed: true,
      populated_count: 0,
      samples: [],
    });
  }

  // Non-variation attribute sinks. WC carries these on every product
  // payload, so detection is reliable even without the taxonomy probe.
  for (const name of BRAND_ATTR_NAMES) {
    const samples: string[] = [];
    let populated = 0;
    for (const p of sample) {
      const attrs = Array.isArray(p.attributes) ? p.attributes : [];
      for (const aRaw of attrs) {
        const a = aRaw as {
          name?: string;
          variation?: boolean;
          options?: string[];
        };
        if (!a || a.variation) continue;
        if ((a.name ?? "").trim().toLowerCase() !== name) continue;
        const v = (a.options ?? [])[0];
        if (typeof v === "string" && v.trim()) {
          populated += 1;
          if (samples.length < 3) samples.push(v.trim());
        }
        break;
      }
    }
    out.push({
      id: `attribute:${name}`,
      label: `Atributo "${capitalize(name)}"`,
      // Whether the attribute exists at all on any product in the sample.
      // Even if `populated_count` is 0 we mark `installed` true if any
      // product references the attribute by that name, since that means
      // the merchant has used this label at least once.
      installed: sampleHasAttributeNamed(sample, name),
      populated_count: populated,
      samples,
    });
  }

  return out;
}

function findBrandlikeTaxonomies(
  taxonomies: Record<string, WpTaxonomyEntry>,
): string[] {
  const found = new Set<string>();
  for (const [slug, entry] of Object.entries(taxonomies)) {
    const types = Array.isArray(entry.types) ? entry.types : [];
    if (!types.includes("product")) continue;
    if (BRANDLIKE_TAXONOMY_HINTS.some((rx) => rx.test(slug))) {
      found.add(slug);
    }
  }
  return [...found];
}

function sampleHasAttributeNamed(
  sample: WooProductRaw[],
  needleLower: string,
): boolean {
  for (const p of sample) {
    const attrs = Array.isArray(p.attributes) ? p.attributes : [];
    for (const aRaw of attrs) {
      const a = aRaw as { name?: string; variation?: boolean };
      if (!a || a.variation) continue;
      if ((a.name ?? "").trim().toLowerCase() === needleLower) return true;
    }
  }
  return false;
}

// ─── Barcode scoring ──────────────────────────────────────────────────────

function scoreBarcodeSinks(sample: WooProductRaw[]): SinkScore[] {
  const out: SinkScore[] = [];

  // WC 8.3+ native: global_unique_id on the product (and on each variation
  // in /products/{id}/variations responses). Detection: field exists in
  // the response. Population: non-empty.
  let nativePop = 0;
  const nativeSamples: string[] = [];
  let nativePresent = false;
  for (const p of sample) {
    const native = (p as { global_unique_id?: unknown }).global_unique_id;
    if (typeof native !== "undefined") nativePresent = true;
    if (typeof native === "string" && native.trim()) {
      nativePop += 1;
      if (nativeSamples.length < 3) nativeSamples.push(native.trim());
    }
  }
  out.push({
    id: "field:global_unique_id",
    label: "Campo nativo global_unique_id (WC 8.3+)",
    installed: nativePresent,
    populated_count: nativePop,
    samples: nativeSamples,
  });

  for (const key of BARCODE_META_KEYS) {
    out.push(scoreMetaKey(sample, key, `meta:${key}`, `meta_data["${key}"]`));
  }

  return out;
}

// ─── Cost scoring ─────────────────────────────────────────────────────────

function scoreCostSinks(sample: WooProductRaw[]): SinkScore[] {
  return COST_META_KEYS.map((key) =>
    scoreMetaKey(sample, key, `meta:${key}`, `meta_data["${key}"]`),
  );
}

// ─── Shared meta-key scorer ──────────────────────────────────────────────

function scoreMetaKey(
  sample: WooProductRaw[],
  needleKey: string,
  id: string,
  label: string,
): SinkScore {
  let populated = 0;
  let installed = false;
  const samples: string[] = [];
  for (const p of sample) {
    const meta = Array.isArray(p.meta_data) ? p.meta_data : [];
    for (const mRaw of meta) {
      const m = mRaw as { key?: string; value?: unknown };
      if (!m || (m.key ?? "") !== needleKey) continue;
      installed = true;
      const val = m.value;
      if (val != null && String(val).trim() !== "") {
        populated += 1;
        if (samples.length < 3) {
          samples.push(String(val).slice(0, 40));
        }
      }
      break;
    }
  }
  return { id, label, installed, populated_count: populated, samples };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
