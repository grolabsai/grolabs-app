/**
 * WC → GroLabs field mapping helpers. Spec: docs/policy/wc-import.md §4.
 *
 * Mapping principle: only obvious 1:1 mappings get columns. Anything
 * else (variations[], unmapped meta_data, attributes, dates, …) lands
 * in product.wc_raw so future processes can consume it losslessly.
 */

import type {
  WooCategoryRaw,
  WooProductRaw,
  WooVariationRaw,
} from "@/lib/sync/woocommerce-client";

/** Keys we explicitly map onto GroLabs columns and therefore strip from wc_raw. */
const MAPPED_KEYS = new Set<string>([
  "id",
  "name",
  "slug",
  "sku",
  "status",
  "description",
  "short_description",
  "regular_price",
  "sale_price",
  "stock_quantity",
  "categories",
]);

/** WC meta_data keys we treat as "obvious" and pull onto columns. */
const BARCODE_KEYS = new Set([
  "_barcode",
  "barcode",
  "_ean",
  "ean",
  "_upc",
  "upc",
  // WC 8.3+ native GTIN meta + popular GTIN plugins (lowest-priority
  // fallbacks; row.global_unique_id is preferred over all of these).
  "_gtin",
  "_wpm_gtin_code",
  "hwp_product_gtin",
]);
const COST_KEYS = new Set([
  "_cost",
  "cost",
  "_wc_cog_cost",
  "_cogs",
  // Cost of Goods for WooCommerce (most popular cost plugin).
  "_alg_wc_cog_cost",
  "_wc_cog_cost_method",
]);

export type CategoryWrite = {
  woocommerce_id: number;
  parent_woocommerce_id: number | null;
  category_name: string;
  slug: string;
  description: string | null;
};

export type ProductWrite = {
  woocommerce_id: number;
  product_name: string;
  slug: string;
  sku: string | null;
  short_description: string | null;
  long_description: string | null;
  image_url: string | null;
  images: Array<{ src: string; alt: string | null }>;
  price: number | null;
  sale_price: number | null;
  stock_quantity: number | null;
  barcode: string | null;
  cost: number | null;
  category_woocommerce_ids: number[];
  wc_raw: Record<string, unknown>;
};

/** One product_variant row, minus instance_id/product_id (the caller owns
 * those). Spec: docs/policy/wc-import.md — minimum viable variations import.
 * Only the columns needed to make a variable product indexable are mapped;
 * the full WC variation object is preserved on product.wc_raw.variations so
 * the search document builder can pull price/stock/image/attributes from it. */
export type VariantWrite = {
  woocommerce_id: number;
  sku: string | null;
  variant_name: string | null;
  barcode: string | null;
  image_url: string | null;
  is_active: boolean;
  /** Converted to grams using the WC store weight_unit when available;
   *  null when WC sent no weight or the unit is unknown. */
  weight_grams: number | null;
};

/** Convert a WC weight string in the store's configured unit to grams. */
export function weightToGrams(
  raw: string | null | undefined,
  unit: "g" | "kg" | "oz" | "lb" | null | undefined,
): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!unit) return null; // Don't guess — better null than wrong-unit data.
  switch (unit) {
    case "g":
      return n;
    case "kg":
      return n * 1000;
    case "oz":
      return n * 28.3495;
    case "lb":
      return n * 453.592;
  }
}

export function mapVariation(
  row: WooVariationRaw,
  opts?: { weightUnit?: "g" | "kg" | "oz" | "lb" | null },
): VariantWrite {
  const meta = Array.isArray(row.meta_data) ? row.meta_data : [];
  const barcodeMeta = meta.find((m) => m && BARCODE_KEYS.has(String(m.key)));
  const nativeGtin =
    typeof row.global_unique_id === "string"
      ? row.global_unique_id.trim() || null
      : null;
  const barcode =
    nativeGtin ??
    (barcodeMeta ? String(barcodeMeta.value).trim() || null : null);

  // Name: join the variation's axis option values (e.g. "Rojo / XL"). WC
  // variation attributes carry the resolved option per axis. Empty when the
  // product has no variation axes — leave null and let the UI fall back.
  const options = Array.isArray(row.attributes)
    ? row.attributes
        .map((a) => (typeof a.option === "string" ? a.option.trim() : ""))
        .filter(Boolean)
    : [];
  const variantName = options.length > 0 ? options.join(" / ") : null;

  const imgSrc =
    row.image && typeof row.image.src === "string"
      ? row.image.src.trim() || null
      : null;

  return {
    woocommerce_id: row.id,
    sku: row.sku?.trim() || null,
    variant_name: variantName,
    barcode,
    image_url: imgSrc,
    // WC variations can be draft/private; only 'publish' is purchasable.
    // Absent status (older WC) → assume active.
    is_active: row.status ? row.status === "publish" : true,
    weight_grams: weightToGrams(
      typeof row.weight === "string" ? row.weight : null,
      opts?.weightUnit ?? null,
    ),
  };
}

// ─── Tags ─────────────────────────────────────────────────────────────────

export type TagWrite = {
  /** Slug-derived natural key, unique per (instance, code). */
  tag_code: string;
  tag_name: string;
};

export function mapTag(t: {
  id?: number;
  name?: string;
  slug?: string;
}): TagWrite | null {
  const name = (t.name ?? "").trim();
  const slug = (t.slug ?? "").trim();
  const codeBase = slug || name;
  if (!codeBase) return null;
  const tag_code = normalizeSlug(codeBase);
  if (!tag_code) return null;
  return { tag_code, tag_name: name || tag_code };
}

// ─── Attribute axes ───────────────────────────────────────────────────────

export type AxisDef = {
  /** Stable, slug-ish key used as product_attribute.attribute_code. WC
   *  taxonomy slugs come through as "pa_size" → we strip the "pa_" so the
   *  GroLabs code matches the natural-language form already used in the
   *  rest of the catalog ("size", "color"). Non-taxonomy attributes (just a
   *  name) are slugified directly. */
  code: string;
  /** Human display name. Falls back to the code title-cased when WC sent
   *  no `name`. */
  name: string;
  /** Position from the WC product attributes array (0-based). Used to
   *  preserve a deterministic variant_axis_order on the category mapping. */
  position: number;
};

/** Strip the WC taxonomy prefix and slugify into snake_case for
 *  attribute_code. WC sometimes also sends raw display names as the slug
 *  ("Marca", "Variante" with capitals) — we still slug-clean those. */
export function toAttributeCode(input: string): string {
  const trimmed = input.trim();
  // WC taxonomy attributes always come through as "pa_<code>".
  const stripped = trimmed.startsWith("pa_") ? trimmed.slice(3) : trimmed;
  return (
    stripped
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "attr"
  );
}

/** Pull the variation-marked axes off a WC parent product's wc_raw. The
 *  return is ordered by WC `position` (falling back to array order) so
 *  category_product_attribute.variant_axis_order is stable across reimports. */
export function deriveAxisDefs(raw: WooProductRaw): AxisDef[] {
  const attrs = Array.isArray(raw.attributes) ? raw.attributes : [];
  const axes: AxisDef[] = [];
  attrs.forEach((entryUnknown, idx) => {
    const entry = entryUnknown as {
      name?: string;
      slug?: string;
      variation?: boolean;
      position?: number;
    } | null;
    if (!entry || !entry.variation) return;
    const slugOrName = (entry.slug ?? entry.name ?? "").trim();
    if (!slugOrName) return;
    const code = toAttributeCode(slugOrName);
    const name = (entry.name ?? code).trim();
    axes.push({
      code,
      name,
      position: typeof entry.position === "number" ? entry.position : idx,
    });
  });
  // Deterministic order even if WC sent the same position twice.
  axes.sort((a, b) => a.position - b.position);
  return axes;
}

/** Slug-normalised value for product_attribute_option.value_code. */
export function toOptionCode(input: string): string {
  return normalizeSlug(input).slice(0, 60) || "opt";
}

export function mapCategory(row: WooCategoryRaw): CategoryWrite {
  return {
    woocommerce_id: row.id,
    parent_woocommerce_id: row.parent && row.parent !== 0 ? row.parent : null,
    category_name: row.name?.trim() || `category-${row.id}`,
    slug: normalizeSlug(row.slug || row.name || `category-${row.id}`),
    description: row.description?.trim() || null,
  };
}

export function mapProduct(row: WooProductRaw): ProductWrite {
  const meta = Array.isArray(row.meta_data) ? row.meta_data : [];

  const barcodeMeta = meta.find((m) => m && BARCODE_KEYS.has(String(m.key)));
  const costMeta = meta.find((m) => m && COST_KEYS.has(String(m.key)));

  // WC 8.3+ native GTIN. Native top-level fields are more reliable than
  // plugin-injected meta_data, so this wins over any BARCODE_KEYS match.
  const nativeGtin =
    typeof row.global_unique_id === "string"
      ? row.global_unique_id.trim() || null
      : null;
  const barcode =
    nativeGtin ??
    (barcodeMeta ? String(barcodeMeta.value).trim() || null : null);

  // Build wc_raw: everything except the keys we mapped onto columns.
  const wcRaw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!MAPPED_KEYS.has(k)) wcRaw[k] = v;
  }

  // images: keep [0] mapped onto image_url for backwards compat; also
  // emit the full ordered array so the caller can materialise
  // product_media rows (one per image, alt preserved). The full row
  // remains in wc_raw too — "images" is not in MAPPED_KEYS.
  const rawImages = Array.isArray(row.images) ? row.images : [];
  const images = rawImages
    .map((img) => {
      const src = img && typeof img.src === "string" ? img.src.trim() : "";
      if (!src) return null;
      const altRaw = img && "alt" in img ? (img as { alt?: unknown }).alt : null;
      const alt = typeof altRaw === "string" && altRaw.trim() ? altRaw.trim() : null;
      return { src, alt };
    })
    .filter((x): x is { src: string; alt: string | null } => x !== null);
  const image0 = images[0]?.src ?? null;

  const categoryIds: number[] = Array.isArray(row.categories)
    ? row.categories.map((c) => Number(c.id)).filter((id) => Number.isFinite(id))
    : [];

  return {
    woocommerce_id: row.id,
    product_name: row.name?.trim() || `product-${row.id}`,
    slug: normalizeSlug(row.slug || row.name || `product-${row.id}`),
    sku: row.sku?.trim() || null,
    short_description: row.short_description?.trim() || null,
    long_description: row.description?.trim() || null,
    image_url: image0,
    images,
    // Variable parents send regular_price: "" — the real price lives in
    // `price`. firstNonEmpty falls through empty/whitespace strings, not
    // just null/undefined (which is what `??` alone would do).
    price: parseDecimal(firstNonEmpty(row.regular_price, row.price)),
    sale_price: parseDecimal(row.sale_price),
    stock_quantity:
      typeof row.stock_quantity === "number" ? row.stock_quantity : null,
    barcode,
    cost: costMeta ? parseDecimal(String(costMeta.value)) : null,
    category_woocommerce_ids: categoryIds,
    wc_raw: wcRaw,
  };
}

/**
 * First value that is not null, undefined, or an empty/whitespace-only
 * string. WC sends regular_price: "" for variable parents, so `??`
 * (null/undefined only) is not enough — the empty string must fall through.
 */
function firstNonEmpty(
  ...values: (string | null | undefined)[]
): string | undefined {
  for (const v of values) {
    if (v != null && v.trim() !== "") return v;
  }
  return undefined;
}

function parseDecimal(v: string | number | undefined | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a slug. WC slugs are usually safe URL strings already, but we
 * strip unsafe chars defensively. We never modify what WC sent in any way
 * that loses identity — wc_raw still has the original on products.
 */
function normalizeSlug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 200) || "untitled"
  );
}

/**
 * Compute hierarchy levels for an imported category set.
 *
 * GroLabs's category.level has a CHECK constraint of (1, 2) — its taxonomy
 * is two levels deep (root + leaf). WC supports arbitrary depth. We
 * clamp: roots → 1, anything else → 2. Full WC depth is still preserved
 * losslessly via parent_category_id, so the future category-matching
 * process can reconstruct the original tree if it needs to.
 */
export function computeCategoryLevels(
  rows: CategoryWrite[],
): Map<number, number> {
  const result = new Map<number, number>();
  for (const row of rows) {
    result.set(row.woocommerce_id, row.parent_woocommerce_id == null ? 1 : 2);
  }
  return result;
}
