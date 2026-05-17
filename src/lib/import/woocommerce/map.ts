/**
 * WC → GroLabs field mapping helpers. Spec: docs/policy/wc-import.md §4.
 *
 * Mapping principle: only obvious 1:1 mappings get columns. Anything
 * else (variations[], unmapped meta_data, attributes, dates, …) lands
 * in product.wc_raw so future processes can consume it losslessly.
 */

import type { WooCategoryRaw, WooProductRaw } from "@/lib/sync/woocommerce-client";

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
const BARCODE_KEYS = new Set(["_barcode", "barcode", "_ean", "ean", "_upc", "upc"]);
const COST_KEYS = new Set(["_cost", "cost", "_wc_cog_cost", "_cogs"]);

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
    price: parseDecimal(row.regular_price ?? row.price),
    sale_price: parseDecimal(row.sale_price),
    stock_quantity:
      typeof row.stock_quantity === "number" ? row.stock_quantity : null,
    barcode: barcodeMeta ? String(barcodeMeta.value).trim() || null : null,
    cost: costMeta ? parseDecimal(String(costMeta.value)) : null,
    category_woocommerce_ids: categoryIds,
    wc_raw: wcRaw,
  };
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
