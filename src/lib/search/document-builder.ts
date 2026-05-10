/**
 * Pure projector from Scout catalog rows → ScoutSearchDocument.
 *
 * Per docs/policy/search-foundations.md §4 (document schema) and §9 (Stage 1
 * enrichment scope). Per the locked PR #68 contract:
 *   - variants[].attributes keys are WC taxonomy slugs (e.g. pa_size), never
 *     display names. Source: product.wc_raw.attributes[].slug for shared axis
 *     keys, wc_raw.variations[].attributes[].slug for per-variation values.
 *
 * No DB I/O. No HTTP. No randomness besides indexed_at. Tests pin every
 * branch in document-builder.test.ts.
 */

import type {
  ScoutSearchDocument,
  ScoutSearchVariant,
  VariationSummary,
  ScoutAttributes,
} from "./types";

// ── Source row shapes ────────────────────────────────────────────────────
//
// Defined inline so this file doesn't depend on a generated Supabase types
// file. The indexer fetches with these column projections.

export type SourceProductRow = {
  product_id: number;
  instance_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  is_active: boolean;
  image_url: string | null;
  woocommerce_id: number | null;
  wc_raw: WcRawShape | null;
  sku: string | null;
  price: number | string | null;
  sale_price: number | string | null;
  stock_quantity: number | null;
  created_at: string;
  updated_at: string;
  brand: { brand_name: string } | null;
};

export type SourceVariantRow = {
  variant_id: number;
  product_id: number;
  variant_name: string | null;
  sku: string | null;
  weight_grams: number | string | null;
  is_active: boolean;
  image_url: string | null;
  product_pricing: Array<{
    list_price: number | string | null;
    sale_price: number | string | null;
    cost_price: number | string | null;
    channel: string;
    currency: string;
  }>;
};

export type SourceCategoryLink = {
  product_id: number;
  is_primary: boolean;
  category: {
    category_id: number;
    category_name: string;
    woocommerce_id: number | null;
  } | null;
};

export type SourceMediaRow = {
  product_id: number;
  variant_id: number | null;
  image_url: string;
  is_primary: boolean;
  sort_order: number;
};

/** Pre-joined Scout-native variant axis row. Source for slug-keyed
 * attributes when wc_raw doesn't carry them (i.e. all Scout-native
 * products on Wazú today).
 *
 * The slug becomes `pa_<attribute_code>` to match the WooCommerce taxonomy
 * convention from PR #68. The value is the user-visible display string —
 * for quantity attributes that's "<number> <unit_code>" (e.g. "3 kg").
 */
export type SourceVariantAttribute = {
  variant_id: number;
  attribute_code: string;
  data_type: string; // 'quantity' | 'number' | 'text' | 'enum' | etc.
  value_text: string | null;
  value_number: number | string | null;
  unit_code: string | null;
  option_value: string | null;
};

/** Subset of the WC product payload that the importer preserves on `wc_raw`.
 * Field names match WC REST v3. We only read the parts we need. */
export type WcRawShape = {
  type?: string; // 'simple' | 'variable' | …
  status?: string;
  permalink?: string;
  default_attributes?: Array<{ id?: number; name?: string; slug?: string; option?: string }>;
  attributes?: Array<{
    id?: number;
    name?: string; // display name (e.g. "Tamaño")
    slug?: string; // taxonomy slug (e.g. "pa_size")
    options?: string[];
    variation?: boolean;
  }>;
  /** WooCommerce's REST API returns this as either:
   *   (a) an array of full variation objects when fetched via
   *       `?include_variations=true` or the dedicated variations endpoint, or
   *   (b) an array of variation IDs (numbers) when fetched from the parent
   *       product endpoint without expansion (Scout's wc-import v1 shape).
   *
   * The builder accepts both — number entries are skipped during the
   * variation lookup. Stage 2+ of the WC import will inline full objects;
   * for v1 the `product_variant` table is the authoritative source for
   * variant data, and the WC-only path serves only as a per-axis slug hint. */
  variations?: Array<
    | number
    | {
        id: number;
        sku?: string | null;
        price?: string | null;
        regular_price?: string | null;
        sale_price?: string | null;
        stock_quantity?: number | null;
        stock_status?: string;
        in_stock?: boolean;
        image?: { src?: string } | null;
        attributes?: Array<{ id?: number; name?: string; slug?: string; option?: string }>;
      }
  >;
  tags?: Array<{ name?: string }>;
};

// ── Public input ─────────────────────────────────────────────────────────

export type BuildDocumentInput = {
  product: SourceProductRow;
  variants: SourceVariantRow[];
  variantAttributes?: SourceVariantAttribute[];
  categoryLinks: SourceCategoryLink[];
  media: SourceMediaRow[];
  storefrontDomain?: string | null;
  currency?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────

const HTML_TAG_RE = /<\/?[^>]+(>|$)/g;
const WHITESPACE_RE = /\s+/g;

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(HTML_TAG_RE, " ").replace(WHITESPACE_RE, " ").trim();
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Slugify a WC attribute name when no `slug` is present on the source row.
 * WC uses `pa_<slug>` for taxonomy attributes — we mirror that convention so
 * keys are stable across product types. Lowercases, ASCII-only, hyphenated. */
function slugifyAttrName(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii ? `pa_${ascii}` : "pa_attr";
}

/** Best-effort lifestage detection from product name + descriptions.
 * Per §9 Stage 1 enrichment — keyword match only, no ML. */
const LIFESTAGE_RULES: Array<{ keys: string[]; tag: string }> = [
  { keys: ["puppy", "cachorro", "cachorros"], tag: "puppy" },
  { keys: ["kitten", "gatito", "gatitos"], tag: "kitten" },
  { keys: ["senior", "anciano", "mayor"], tag: "senior" },
  { keys: ["adult", "adulto", "adultos"], tag: "adult" },
];

function detectLifestage(...sources: Array<string | null | undefined>): string[] {
  const haystack = sources.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return [];
  const found = new Set<string>();
  for (const rule of LIFESTAGE_RULES) {
    if (rule.keys.some((k) => haystack.includes(k))) found.add(rule.tag);
  }
  return [...found];
}

// ── Variant projection ───────────────────────────────────────────────────

/** Pick the best price + channel + image for a variant. Mirror algolia-mapping's
 * preference order (retail first, else first row). */
function variantPricing(v: SourceVariantRow): {
  price: number | null;
  sale: number | null;
  currency: string | null;
} {
  const retail =
    v.product_pricing?.find((pr) => pr.channel === "retail") ?? v.product_pricing?.[0];
  return {
    price: num(retail?.list_price ?? null),
    sale: num(retail?.sale_price ?? null),
    currency: retail?.currency ?? null,
  };
}

/** Look up the WC variation row that matches a Scout variant by SKU. Returns
 * null when wc_raw.variations is the v1 shape (array of integer IDs). */
type WcVariationObject = Exclude<
  NonNullable<WcRawShape["variations"]>[number],
  number
>;

function isVariationObject(v: unknown): v is WcVariationObject {
  return typeof v === "object" && v !== null;
}

function matchWcVariation(
  v: SourceVariantRow,
  wcVariations: WcRawShape["variations"]
): WcVariationObject | null {
  if (!wcVariations || wcVariations.length === 0) return null;
  const objectVariations = wcVariations.filter(isVariationObject);
  if (objectVariations.length === 0) return null;
  if (v.sku) {
    const bySku = objectVariations.find((wv) => wv.sku && wv.sku === v.sku);
    if (bySku) return bySku;
  }
  return null;
}

/** Build the slug-keyed attributes map for one variant.
 *
 * Source priority:
 *   1. Scout-native: product_variant_attribute joined with product_attribute.
 *      Key = `pa_<attribute_code>`. Value = display string per data_type.
 *      This is the path for almost all Wazú data — Scout's importers populate
 *      product_variant_attribute, not wc_raw.variations[i].attributes.
 *   2. wc_raw.variations[i].attributes (slug + option) — matched by SKU.
 *      Path for products that arrived with a fully-expanded WC variation
 *      payload (rare today; full WC variation pulls are a Stage 2 import).
 *   3. Last resort: positional split of variant_name against wc_raw.attributes
 *      with variation=true.
 *
 * Returns {} if nothing usable. Per PR #68 the keys must be slugs — every
 * path here emits slug-shaped keys (or skips the entry).
 */
function buildVariantAttributes(
  v: SourceVariantRow,
  wcRaw: WcRawShape | null,
  scoutAttrs: SourceVariantAttribute[]
): Record<string, string> {
  // 1. Scout-native rows. Always preferred when present.
  const scoutForVariant = scoutAttrs.filter((a) => a.variant_id === v.variant_id);
  if (scoutForVariant.length > 0) {
    const out: Record<string, string> = {};
    for (const a of scoutForVariant) {
      const value = displayValueForVariantAttribute(a);
      if (value === null) continue;
      out[`pa_${a.attribute_code}`] = value;
    }
    if (Object.keys(out).length > 0) return out;
  }

  // 2. wc_raw embedded variation attributes.
  const out: Record<string, string> = {};
  if (wcRaw?.variations && wcRaw.variations.some(isVariationObject)) {
    const wv = matchWcVariation(v, wcRaw.variations);
    if (wv?.attributes) {
      for (const a of wv.attributes) {
        if (!a.option) continue;
        const slug = a.slug && a.slug.trim() ? a.slug : a.name ? slugifyAttrName(a.name) : null;
        if (!slug) continue;
        out[slug] = String(a.option);
      }
      if (Object.keys(out).length > 0) return out;
    }
  }

  // 3. Positional split of variant_name. Spotty in practice, last resort.
  const axisDefs = (wcRaw?.attributes ?? []).filter((a) => a.variation);
  const parts = (v.variant_name ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0 && axisDefs.length > 0) {
    parts.forEach((value, i) => {
      const def = axisDefs[i];
      if (!def) return;
      const slug = def.slug && def.slug.trim() ? def.slug : def.name ? slugifyAttrName(def.name) : null;
      if (!slug) return;
      out[slug] = value;
    });
  }

  return out;
}

/** Render one product_variant_attribute row to the user-visible display
 * string. Returns null when the row carries no usable value (e.g. a quantity
 * row with a missing unit). */
function displayValueForVariantAttribute(a: SourceVariantAttribute): string | null {
  if (a.option_value && a.option_value.trim()) return a.option_value.trim();
  if (a.data_type === "quantity") {
    const numStr = a.value_number != null ? String(a.value_number) : null;
    if (!numStr) return null;
    return a.unit_code ? `${numStr} ${a.unit_code}` : numStr;
  }
  if (a.value_text && a.value_text.trim()) return a.value_text.trim();
  if (a.value_number != null) return String(a.value_number);
  return null;
}

function projectVariant(
  v: SourceVariantRow,
  wcRaw: WcRawShape | null,
  scoutAttrs: SourceVariantAttribute[]
): ScoutSearchVariant {
  const wc = matchWcVariation(v, wcRaw?.variations);
  const pricing = variantPricing(v);

  // Stock semantics: prefer wc_raw (authoritative for WC-imported products),
  // fall back to is_active. stock_quantity stays null when unknown.
  const stockQty = wc?.stock_quantity ?? null;
  const inStock =
    wc?.in_stock !== undefined
      ? !!wc.in_stock
      : wc?.stock_status
      ? wc.stock_status === "instock"
      : !!v.is_active;

  return {
    variation_id: v.variant_id,
    sku: v.sku ?? null,
    attributes: buildVariantAttributes(v, wcRaw, scoutAttrs),
    price: pricing.price ?? num(wc?.regular_price ?? wc?.price ?? null),
    sale_price: pricing.sale ?? num(wc?.sale_price ?? null),
    in_stock: inStock,
    stock_quantity: stockQty,
    image_url: v.image_url ?? wc?.image?.src ?? null,
  };
}

// ── Variation summary ────────────────────────────────────────────────────

function computeVariationSummary(
  product: SourceProductRow,
  variants: ScoutSearchVariant[]
): VariationSummary {
  const wcType = product.wc_raw?.type;
  const purchasable = variants.filter((v) => v.in_stock);
  const purchasableCount = purchasable.length;

  // Per §4: simple = WC simple OR not variable + ≤1 variant.
  // variable_single = variable + exactly one purchasable.
  // variable_multi  = variable + ≥2 purchasable.
  //
  // Edge case: WC import v1 leaves `wc_raw.type='variable'` but does not
  // populate `product_variant` rows for that product (variation pulls are
  // out of scope for the importer's first pass). Force 'simple' so the
  // resulting document has consistent commerce mirrors at the top level
  // — better a degraded simple-card than a malformed variable-with-no-variants.
  let type: VariationSummary["type"];
  if (variants.length === 0) {
    type = "simple";
  } else if (wcType === "variable") {
    type = purchasableCount >= 2 ? "variable_multi" : "variable_single";
  } else if (variants.length <= 1) {
    type = "simple";
  } else {
    type = purchasableCount >= 2 ? "variable_multi" : "variable_single";
  }

  // Default variation per §4 rules.
  let defaultId: number | null = null;
  if (type === "simple") {
    defaultId = product.product_id;
  } else if (type === "variable_single") {
    defaultId = purchasable[0]?.variation_id ?? variants[0]?.variation_id ?? null;
  } else {
    // variable_multi: WC marks default via wc_raw.default_attributes; match by attribute set.
    const wcDefault = matchDefaultByAttributes(product.wc_raw, variants);
    defaultId = wcDefault ?? purchasable[0]?.variation_id ?? null;
  }

  const defaultSku =
    type === "simple"
      ? product.sku ?? null
      : variants.find((v) => v.variation_id === defaultId)?.sku ?? null;

  const prices = variants.map((v) => v.price).filter((p): p is number => p != null);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  const anyInStock = variants.some((v) => v.in_stock) || (variants.length === 0 && product.is_active);
  const allInStock = variants.length > 0 && variants.every((v) => v.in_stock);

  return {
    type,
    purchasable_variation_count: purchasableCount,
    default_variation_id: defaultId,
    default_variation_sku: defaultSku,
    price_range: { min, max },
    in_stock_summary: { any_in_stock: anyInStock, all_in_stock: allInStock },
  };
}

function matchDefaultByAttributes(
  wcRaw: WcRawShape | null,
  variants: ScoutSearchVariant[]
): number | null {
  const defaults = wcRaw?.default_attributes;
  if (!defaults || defaults.length === 0) return null;
  const wanted: Record<string, string> = {};
  for (const d of defaults) {
    if (!d.option) continue;
    const slug = d.slug && d.slug.trim() ? d.slug : d.name ? slugifyAttrName(d.name) : null;
    if (slug) wanted[slug] = String(d.option);
  }
  if (Object.keys(wanted).length === 0) return null;
  const match = variants.find((v) =>
    Object.entries(wanted).every(([k, val]) => v.attributes[k] === val)
  );
  return match?.variation_id ?? null;
}

// ── Top-level builder ────────────────────────────────────────────────────

export function buildScoutSearchDocument(input: BuildDocumentInput): ScoutSearchDocument {
  const { product, variants: variantRows, categoryLinks, media } = input;
  const scoutAttrs = input.variantAttributes ?? [];

  // Filter: per §9, exclude inactive variations.
  const activeVariants = variantRows.filter((v) => v.is_active);

  const variants = activeVariants.map((v) => projectVariant(v, product.wc_raw, scoutAttrs));

  const summary = computeVariationSummary(product, variants);

  // Categories — names + ids. category_ids is WC ids per §4.
  const links = categoryLinks.filter((l) => l.product_id === product.product_id);
  const categories = links
    .map((l) => l.category?.category_name)
    .filter((n): n is string => !!n);
  const category_ids = links
    .map((l) => l.category?.woocommerce_id)
    .filter((id): id is number => typeof id === "number");

  // Media — primary first, then sort_order. Product-scoped only (variant
  // media has its own image_url on the variant).
  const productMedia = media
    .filter((m) => m.product_id === product.product_id && m.variant_id == null)
    .slice()
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  const primary = productMedia[0]?.image_url ?? product.image_url ?? null;

  // Tags — pulled from wc_raw.tags if present (Scout has no native tag table).
  const tags = (product.wc_raw?.tags ?? [])
    .map((t) => t.name)
    .filter((n): n is string => !!n);

  // URL — best effort. If we have a permalink in wc_raw, use it; else compose
  // from storefrontDomain + slug.
  const wcPermalink = product.wc_raw?.permalink;
  const url =
    wcPermalink ??
    (input.storefrontDomain
      ? `https://${input.storefrontDomain}/product/${product.slug}`
      : `/product/${product.slug}`);

  // Top-level commerce mirrors. Per §4: variable products use price_range.min.
  const topPrice = summary.type === "simple" ? num(product.price) ?? summary.price_range.min : summary.price_range.min;
  const topSale = summary.type === "simple" ? num(product.sale_price) : null;
  const inStock = summary.in_stock_summary.any_in_stock;

  const description = stripHtml(product.long_description);
  const shortDescription = stripHtml(product.short_description);

  const scout_attributes: ScoutAttributes = {
    species: [],
    lifestage: detectLifestage(product.product_name, description, shortDescription),
    breed_compatibility: [],
    size: null,
    weight_grams: null,
    food_type: null,
    medical_conditions: [],
    age_min_months: null,
    age_max_months: null,
  };

  return {
    id: product.product_id,
    instance_id: product.instance_id,
    woocommerce_id: product.woocommerce_id ?? null,

    name: product.product_name,
    slug: product.slug,
    description,
    short_description: shortDescription,
    url,
    image_url: primary,
    thumbnail_url: primary,

    categories,
    category_ids,
    tags,
    brand: product.brand?.brand_name ?? null,

    scout_attributes,
    variation_summary: summary,
    variants,

    price: topPrice,
    sale_price: topSale,
    currency: input.currency ?? "GTQ",
    in_stock: inStock,
    sku: product.sku ?? null,

    popularity: 0,
    created_at: product.created_at,
    updated_at: product.updated_at,
    indexed_at: new Date().toISOString(),
    _schema_version: 1,
  };
}
