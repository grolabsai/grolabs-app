/**
 * Read-only GroLabs → WooCommerce field mapping.
 *
 * Documented for the user (rendered in the Sync Manager's mapping modal),
 * read at runtime by the push action. To change the mapping, edit this
 * file — it's intentionally not customer-configurable for v1 (see
 * docs/state/in-flight.md → "Sync field mappings").
 *
 * Push model:
 *   - One GroLabs product → one WC parent product of `type: variable`
 *     (always; we don't try to detect single-variant products and use
 *     `type: simple`, that complicates round-tripping).
 *   - Each GroLabs variant → one WC variation under that parent.
 *   - WC requires SKU on every variation. Variants without SKU are skipped.
 *
 * Categories:
 *   - WooCommerce's REST API requires `categories: [{ id }]`. Name-only
 *     entries are silently ignored — products land with no categories.
 *   - The caller pre-syncs the category tree (see
 *     `syncCategoryTreeToWoocommerce` in woocommerce-categories.ts), then
 *     passes the resulting GroLabs→WC id map into this function. We emit
 *     `categories: [{ id: wcId }]` for every GroLabs category we have a
 *     mapping for. Unmapped categories surface via `unmappedCategoryIds`
 *     so the caller can warn the user.
 *
 * Brand:
 *   - WC core has no brand entity. Many sites use the "Perfect Brands for
 *     WooCommerce" plugin which exposes brands as a custom taxonomy
 *     (taxonomy=`pwb-brand`). For v1 we send brand as both an attribute
 *     (always works) and as `meta_data[scout_brand]` so other plugins can
 *     pick it up. If you use Perfect Brands, swap this to use `pwb-brand`
 *     once you've confirmed it's installed.
 */

import type { AlgoliaSourceProduct } from "@/lib/sync/algolia-mapping";
import type {
  ProductPayload,
  VariationPayload,
} from "@/lib/sync/woocommerce-client";

export type FieldMappingRow = {
  scoutField: string;
  wpField: string;
  required: boolean;
  note: string;
};

export const WOOCOMMERCE_FIELD_MAPPINGS: FieldMappingRow[] = [
  { scoutField: "product.product_name", wpField: "name", required: true, note: "Nombre del producto padre (variable)." },
  { scoutField: "product.long_description", wpField: "description", required: false, note: "Descripción completa." },
  { scoutField: "product.short_description", wpField: "short_description", required: false, note: "Descripción corta para tarjetas y subtítulos." },
  { scoutField: "product.slug", wpField: "slug", required: false, note: "Slug del permalink." },
  { scoutField: "product.is_active", wpField: "status", required: false, note: "publish | draft según el estado del producto en GroLabs." },
  { scoutField: "product.product_category_link.category_id", wpField: "categories", required: false, note: "Array de ids de categoría WooCommerce; el árbol se sincroniza primero (category_sync_status mapea GroLabs → WC)." },
  { scoutField: "product.brand.brand_name", wpField: "attributes / meta_data[scout_brand]", required: false, note: "Atributo \"Marca\" + meta. Para sitios con Perfect Brands, cambiar a la taxonomía pwb-brand." },
  { scoutField: "product_variant.variant_name", wpField: "attributes (per variant)", required: false, note: "Cada eje del variant_name se envía como atributo de variación." },
  { scoutField: "product_variant.sku", wpField: "variation.sku", required: true, note: "Cada variación necesita un SKU único en WC." },
  { scoutField: "product_variant.barcode", wpField: "variation.meta_data[barcode]", required: false, note: "Meta personalizada (no hay campo nativo)." },
  { scoutField: "product_variant.weight_grams", wpField: "variation.weight", required: false, note: "Convertido de gramos a kg (WC asume kg salvo configuración distinta)." },
  { scoutField: "product_pricing.list_price (retail)", wpField: "variation.regular_price", required: false, note: "Precio regular como string (WC requiere string)." },
  { scoutField: "product_pricing.cost_price (retail)", wpField: "variation.meta_data[scout_cost]", required: false, note: "Meta personalizada; WC no tiene costo nativo." },
  { scoutField: "product_media (is_primary)", wpField: "images / variation.image", required: false, note: "Foto principal en el producto padre y en cada variación." },
];

/** Default category-ish name we attach to brand attributes. */
const BRAND_ATTR_NAME = "Marca";

export type ScoutToWcResult = {
  parent: ProductPayload;
  variations: VariationPayload[];
  /** SKUs of the variants that were skipped because they had no SKU. */
  skippedVariantIds: number[];
  /**
   * GroLabs category ids on the product that we couldn't map to a WC
   * category id (sync helper failed for those). Caller surfaces a
   * per-product warning when this list is non-empty.
   */
  unmappedCategoryIds: number[];
};

export type WcMappingOptions = {
  /**
   * GroLabs category_id → WooCommerce category id. Built by
   * syncCategoryTreeToWoocommerce. Categories not in the map are emitted
   * to `unmappedCategoryIds` and not included in the WC payload.
   */
  categoryIdByScoutId?: Map<number, number>;
};

/**
 * Project a GroLabs product (with variants) onto a WooCommerce parent +
 * variation set. Mirrors `mapProductToAlgoliaRecords` for symmetry.
 */
export function mapProductToWooCommerce(
  p: AlgoliaSourceProduct,
  opts: WcMappingOptions = {},
): ScoutToWcResult {
  const skippedVariantIds: number[] = [];
  const unmappedCategoryIds: number[] = [];

  // Parent-level images, primary first. Variant-scoped media (variant_id
  // not null) belongs to a single variant and is plucked separately when
  // each variation is mapped below. If the product has no parent-level
  // media but the legacy `product.image_url` is populated (the state of
  // WC-imported rows from before the product_media backfill landed),
  // fabricate a single entry so the sync still pushes an image to WC.
  const parentMedia = (p.product_media ?? [])
    .filter((m) => m.variant_id == null)
    .slice()
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  const images: Array<{ src: string; alt?: string }> =
    parentMedia.length > 0
      ? parentMedia.map((m) => ({ src: m.image_url }))
      : p.image_url
        ? [{ src: p.image_url }]
        : [];
  const parentPrimaryImage = images[0];

  // Categories — emit WC ids from the pre-built map. Unmapped GroLabs
  // categories are reported back so the caller can surface a warning.
  const categoryMap = opts.categoryIdByScoutId;
  const categories: Array<{ id: number }> = [];
  for (const link of p.product_category_link ?? []) {
    const scoutId = link.category_id;
    if (typeof scoutId !== "number") continue;
    const wcId = categoryMap?.get(scoutId);
    if (wcId === undefined) {
      unmappedCategoryIds.push(scoutId);
      continue;
    }
    categories.push({ id: wcId });
  }

  // Brand
  const brandName = p.brand?.brand_name ?? null;
  const brandAttributes = brandName
    ? [
        {
          name: BRAND_ATTR_NAME,
          visible: true,
          variation: false,
          options: [brandName],
        },
      ]
    : [];

  // Build the per-variant attributes set. WC variable products require:
  //   parent.attributes: [{ name, options: [...all options across variants...], variation: true }]
  //   variation.attributes: [{ name, option: "value for this variant" }]
  // GroLabs's variant_name carries the variant axis values. For v1 we
  // collapse them into a single "Variante" attribute. Future: split per
  // axis (Contenido / Tamaño / etc.) once axis data is plumbed through
  // here. For now, single-attribute variation works in WC and the variant
  // names ("1 kg", "Mediano / Rojo") are intelligible.
  const variantAxisName = "Variante";
  const variantOptions = new Set<string>();
  for (const v of p.product_variant ?? []) {
    if (v.variant_name) variantOptions.add(v.variant_name);
  }

  const parentAttributes = [
    ...brandAttributes,
    ...(variantOptions.size > 0
      ? [
          {
            name: variantAxisName,
            visible: true,
            variation: true,
            options: Array.from(variantOptions),
          },
        ]
      : []),
  ];

  const parent: ProductPayload = {
    name: p.product_name,
    type: "variable",
    status: p.is_active ? "publish" : "draft",
    description: p.long_description ?? undefined,
    short_description: p.short_description ?? undefined,
    categories: categories.length > 0 ? categories : undefined,
    images: images.length > 0 ? images : undefined,
    attributes: parentAttributes.length > 0 ? parentAttributes : undefined,
    meta_data: brandName ? [{ key: "scout_brand", value: brandName }] : undefined,
  };

  const variations: VariationPayload[] = [];
  for (const v of p.product_variant ?? []) {
    if (!v.sku || !v.sku.trim()) {
      skippedVariantIds.push(v.variant_id);
      continue;
    }
    const retail =
      v.product_pricing?.find((pr) => pr.channel === "retail") ??
      v.product_pricing?.[0];
    const listPrice = retail?.list_price ? Number(retail.list_price) : null;
    const costPrice = retail?.cost_price ? Number(retail.cost_price) : null;
    const weightKg = v.weight_grams ? Number(v.weight_grams) / 1000 : null;

    const meta: VariationPayload["meta_data"] = [];
    if (v.barcode) meta.push({ key: "barcode", value: v.barcode });
    if (Number.isFinite(costPrice) && costPrice !== null) meta.push({ key: "scout_cost", value: costPrice });

    // Per-variation image: prefer the variant's own primary product_media
    // row when present; otherwise inherit the parent's primary. WC
    // expects a single { src } object on `variation.image`.
    const variantOwnMedia = (p.product_media ?? [])
      .filter((m) => m.variant_id === v.variant_id)
      .slice()
      .sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
    const variantPrimary =
      variantOwnMedia[0] !== undefined
        ? { src: variantOwnMedia[0].image_url }
        : undefined;

    variations.push({
      sku: v.sku.trim(),
      regular_price:
        Number.isFinite(listPrice) && listPrice !== null ? listPrice.toString() : undefined,
      stock_status: v.is_active ? "instock" : "outofstock",
      weight: Number.isFinite(weightKg) && weightKg !== null ? weightKg.toString() : undefined,
      image: variantPrimary ?? parentPrimaryImage,
      attributes: [
        {
          name: variantAxisName,
          option: v.variant_name ?? v.sku.trim(),
        },
      ],
      meta_data: meta.length > 0 ? meta : undefined,
    });
  }

  return { parent, variations, skippedVariantIds, unmappedCategoryIds };
}
