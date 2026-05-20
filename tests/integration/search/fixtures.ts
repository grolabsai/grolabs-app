/**
 * Synthetic products used by tests/integration/search/**.
 *
 * Shape matches ScoutSearchDocument minus the fields the test suite doesn't
 * care about (defaults filled in by buildFixtures()). Keep the catalog
 * small — every fixture costs ~one Meilisearch indexing task during setup.
 *
 * Naming convention: keywords in product `name` are intentionally distinct
 * across categories so each test case can assert on a deterministic
 * keyword↔category mapping:
 *
 *   "Magicword …"   → only in CAT_A
 *   "Otherword …"   → only in CAT_B
 *   "Common Item"   → spans CAT_B and CAT_C
 *
 * Variant products carry one in-stock + one out-of-stock variation so the
 * matched_variation pick-best logic can be exercised without setting up
 * separate fixture sets.
 */

import type {
  ScoutSearchDocument,
  ScoutSearchVariant,
  VariationSummary,
  ScoutAttributes,
} from "@/lib/search/types";

export const TEST_INSTANCE_ID = 99999;
export const TEST_ORIGIN = "https://test.local";

export const CAT_A = 90001; // "TestCategory A"
export const CAT_B = 90002; // "TestCategory B"
export const CAT_C = 90003; // "TestCategory C" (shared with B)

/** Stable IDs so tests can assert by id. */
export const PRODUCT_IDS = {
  magicwordA1: 90001001,
  magicwordA2: 90001002,
  otherwordB1: 90002001,
  commonBC:    90002002, // Product spanning B + C
  commonC:     90003001,
  variableA:   90001003, // Variable product for matched_variation tests
} as const;

const NOW = "2026-05-20T00:00:00.000Z";

function defaultAttributes(): ScoutAttributes {
  return {
    species: [],
    lifestage: [],
    breed_compatibility: [],
    size: null,
    weight_grams: null,
    food_type: null,
    medical_conditions: [],
    age_min_months: null,
    age_max_months: null,
  } as unknown as ScoutAttributes;
}

function summaryFor(type: VariationSummary["type"], variants: ScoutSearchVariant[]): VariationSummary {
  const inStockVariants = variants.filter((v) => v.in_stock);
  const prices = variants.map((v) => v.price ?? 0).filter((p) => p > 0);
  return {
    type,
    purchasable_variation_count: inStockVariants.length,
    default_variation_id: variants[0]?.variation_id ?? null,
    default_variation_sku: variants[0]?.sku ?? null,
    price_range: {
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
    },
    in_stock_summary: {
      any_in_stock: inStockVariants.length > 0,
      all_in_stock: inStockVariants.length === variants.length && variants.length > 0,
    },
  };
}

function simpleDoc(input: {
  id: number;
  name: string;
  categoryIds: number[];
  categoryNames: string[];
  price?: number;
  inStock?: boolean;
}): ScoutSearchDocument {
  return {
    id: input.id,
    instance_id: TEST_INSTANCE_ID,
    woocommerce_id: input.id, // 1:1 in fixtures
    name: input.name,
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    description: "",
    short_description: "",
    url: `https://test.local/product/${input.id}`,
    image_url: null,
    thumbnail_url: null,
    categories: input.categoryNames,
    category_ids: input.categoryIds,
    tags: [],
    brand: null,
    scout_attributes: defaultAttributes(),
    attributes: {},
    variation_summary: summaryFor("simple", []),
    variants: [],
    price: input.price ?? 100,
    sale_price: null,
    currency: "GTQ",
    in_stock: input.inStock ?? true,
    sku: `SKU-${input.id}`,
    popularity: 0,
    created_at: NOW,
    updated_at: NOW,
    indexed_at: NOW,
    _schema_version: 1,
  };
}

function variableDoc(input: {
  id: number;
  name: string;
  categoryIds: number[];
  categoryNames: string[];
}): ScoutSearchDocument {
  const variants: ScoutSearchVariant[] = [
    {
      variation_id: input.id * 10 + 1,
      sku: `SKU-${input.id}-S`,
      attributes: { pa_size: "small" },
      price: 100,
      sale_price: null,
      in_stock: true,
      stock_quantity: 10,
      image_url: null,
    },
    {
      variation_id: input.id * 10 + 2,
      sku: `SKU-${input.id}-L`,
      attributes: { pa_size: "large" },
      price: 200,
      sale_price: null,
      in_stock: false, // Out-of-stock variant
      stock_quantity: 0,
      image_url: null,
    },
  ];
  return {
    id: input.id,
    instance_id: TEST_INSTANCE_ID,
    woocommerce_id: input.id,
    name: input.name,
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    description: "",
    short_description: "",
    url: `https://test.local/product/${input.id}`,
    image_url: null,
    thumbnail_url: null,
    categories: input.categoryNames,
    category_ids: input.categoryIds,
    tags: [],
    brand: null,
    scout_attributes: defaultAttributes(),
    attributes: {},
    variation_summary: summaryFor("variable_multi", variants),
    variants,
    price: 100,
    sale_price: null,
    currency: "GTQ",
    in_stock: true,
    sku: null,
    popularity: 0,
    created_at: NOW,
    updated_at: NOW,
    indexed_at: NOW,
    _schema_version: 1,
  };
}

/** All synthetic fixtures, ready to push to Meilisearch. */
export const FIXTURES: ScoutSearchDocument[] = [
  simpleDoc({
    id: PRODUCT_IDS.magicwordA1,
    name: "Magicword Widget A1",
    categoryIds: [CAT_A],
    categoryNames: ["TestCategory A"],
  }),
  simpleDoc({
    id: PRODUCT_IDS.magicwordA2,
    name: "Magicword Widget A2",
    categoryIds: [CAT_A],
    categoryNames: ["TestCategory A"],
  }),
  simpleDoc({
    id: PRODUCT_IDS.otherwordB1,
    name: "Otherword Widget B1",
    categoryIds: [CAT_B],
    categoryNames: ["TestCategory B"],
  }),
  simpleDoc({
    id: PRODUCT_IDS.commonBC,
    name: "Common Item",
    categoryIds: [CAT_B, CAT_C],
    categoryNames: ["TestCategory B", "TestCategory C"],
  }),
  simpleDoc({
    id: PRODUCT_IDS.commonC,
    name: "Common Item Extra",
    categoryIds: [CAT_C],
    categoryNames: ["TestCategory C"],
  }),
  variableDoc({
    id: PRODUCT_IDS.variableA,
    name: "Variable Magicword Item",
    categoryIds: [CAT_A],
    categoryNames: ["TestCategory A"],
  }),
];
