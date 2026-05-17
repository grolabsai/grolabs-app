/**
 * Read-only GroLabs → Algolia field mapping.
 *
 * Documented for the user (rendered in the Sync Manager's mapping modal),
 * read at runtime by the push action. To change the mapping, edit this
 * file — it's intentionally not a customer-configurable setting (see
 * docs/state/in-flight.md → "Sync field mappings").
 *
 * One Algolia record per VARIANT. `objectID = sku` (Algolia's required
 * unique identifier). Variants without a SKU are skipped at push time —
 * Algolia rejects records with no objectID.
 */

// We don't depend on a generated Supabase types file — define just the
// rows we read here. Keeps this file self-contained.
export type AlgoliaSourceProduct = {
  product_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  is_active: boolean;
  // Legacy single-image column kept on `product` for products imported
  // before product_media existed. The WC sync uses it as a fallback
  // when product_media is empty (see woocommerce-mapping.ts).
  image_url: string | null;
  brand: { brand_name: string } | null;
  product_category_link: Array<{
    is_primary: boolean;
    category_id: number | null;
    category: { category_name: string; slug: string } | null;
  }>;
  // variant_id is non-null for variant-scoped photos and null for
  // product-level photos. Mappers filter on it: the parent payload
  // uses null-only rows; each variation's .image prefers its own
  // variant_id rows and falls back to the parent set.
  product_media: Array<{
    image_url: string;
    is_primary: boolean;
    sort_order: number;
    variant_id: number | null;
  }>;
  product_variant: Array<{
    variant_id: number;
    variant_name: string | null;
    sku: string | null;
    barcode: string | null;
    weight_grams: string | null;
    is_active: boolean;
    product_pricing: Array<{
      list_price: string | null;
      cost_price: string | null;
      channel: string;
      currency: string;
    }>;
  }>;
};

/** One Algolia record. Field set is documented in the modal. */
export type AlgoliaRecord = {
  objectID: string;
  product_id: number;
  variant_id: number;
  name: string;
  slug: string;
  description: string | null;
  short_description: string | null;
  brand: string | null;
  categories: string[];
  primary_category: string | null;
  sku: string;
  barcode: string | null;
  weight_grams: number | null;
  price: number | null;
  cost_price: number | null;
  currency: string;
  image: string | null;
  images: string[];
  in_stock: boolean;
  is_active: boolean;
};

export type FieldMappingRow = {
  /** Path into the GroLabs data (informational, displayed in the modal). */
  scoutField: string;
  /** Algolia attribute name. */
  algoliaField: string;
  required: boolean;
  note: string;
};

/**
 * The mapping table for the Configurar mapeo modal. Pure documentation
 * — the actual projection lives in `mapVariantToAlgolia` below.
 */
export const ALGOLIA_FIELD_MAPPINGS: FieldMappingRow[] = [
  { scoutField: "product_variant.sku", algoliaField: "objectID", required: true, note: "Identificador único en Algolia. Se usa el SKU de cada variante." },
  { scoutField: "product.product_name + variant.variant_name", algoliaField: "name", required: false, note: "Nombre completo del producto + variante." },
  { scoutField: "product.short_description", algoliaField: "short_description", required: false, note: "Descripción corta para tarjetas de búsqueda." },
  { scoutField: "product.long_description", algoliaField: "description", required: false, note: "Descripción completa." },
  { scoutField: "product.product_id", algoliaField: "product_id", required: false, note: "ID interno; útil para distinct/groupBy en Algolia." },
  { scoutField: "product.slug", algoliaField: "slug", required: false, note: "Slug del producto base." },
  { scoutField: "product.brand.brand_name", algoliaField: "brand", required: false, note: "Marca." },
  { scoutField: "product_category_link.category.category_name", algoliaField: "categories", required: false, note: "Array con todas las categorías asociadas." },
  { scoutField: "product_category_link.category (is_primary)", algoliaField: "primary_category", required: false, note: "Categoría marcada como principal." },
  { scoutField: "product_variant.barcode", algoliaField: "barcode", required: false, note: "Código de barras (UPC/EAN)." },
  { scoutField: "product_variant.weight_grams", algoliaField: "weight_grams", required: false, note: "Peso en gramos para filtros numéricos." },
  { scoutField: "product_pricing.list_price (retail)", algoliaField: "price", required: false, note: "Precio de lista del canal retail." },
  { scoutField: "product_pricing.cost_price (retail)", algoliaField: "cost_price", required: false, note: "Costo del canal retail." },
  { scoutField: "product_pricing.currency", algoliaField: "currency", required: false, note: "Código de moneda (GTQ por defecto)." },
  { scoutField: "product_media.image_url (is_primary)", algoliaField: "image", required: false, note: "URL de la imagen principal." },
  { scoutField: "product_media.image_url[]", algoliaField: "images", required: false, note: "Array de todas las URLs de imágenes ordenadas." },
  { scoutField: "product_variant.is_active && product.is_active", algoliaField: "in_stock", required: false, note: "Booleano derivado: producto activo y variante activa." },
  { scoutField: "product_variant.is_active", algoliaField: "is_active", required: false, note: "Estado activo de la variante." },
];

/**
 * Project a GroLabs product (with its variants) into one or more Algolia
 * records. Skips variants without a SKU — Algolia rejects them.
 */
export function mapProductToAlgoliaRecords(p: AlgoliaSourceProduct): AlgoliaRecord[] {
  // Parent-level media only — variant-scoped rows belong to a single
  // variant and are projected onto that variant's record below.
  const parentMedia = (p.product_media ?? [])
    .filter((m) => m.variant_id == null)
    .slice()
    .sort((a, b) => {
      // Primary first, then by sort_order
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  const parentPrimaryImage = parentMedia[0]?.image_url ?? null;
  const allImageUrls = parentMedia.map((m) => m.image_url);

  const categories = (p.product_category_link ?? [])
    .map((l) => l.category?.category_name)
    .filter((n): n is string => !!n);
  const primaryCategory =
    p.product_category_link?.find((l) => l.is_primary)?.category?.category_name ?? null;

  const records: AlgoliaRecord[] = [];
  for (const v of p.product_variant ?? []) {
    if (!v.sku || !v.sku.trim()) continue;
    // Prefer retail pricing; if absent, use the first row.
    const retail =
      v.product_pricing?.find((pr) => pr.channel === "retail") ??
      v.product_pricing?.[0];
    const listPrice = retail?.list_price ? Number(retail.list_price) : null;
    const costPrice = retail?.cost_price ? Number(retail.cost_price) : null;
    const currency = retail?.currency ?? "GTQ";

    const variantSuffix = v.variant_name ? ` ${v.variant_name}` : "";
    const fullName = `${p.product_name}${variantSuffix}`.trim();

    // Variant-scoped images take precedence over the parent set when
    // present; otherwise the variant inherits the parent primary.
    const variantMedia = (p.product_media ?? [])
      .filter((m) => m.variant_id === v.variant_id)
      .slice()
      .sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
    const variantPrimary = variantMedia[0]?.image_url ?? null;
    const recordImages = variantMedia.length > 0
      ? variantMedia.map((m) => m.image_url)
      : allImageUrls;

    records.push({
      objectID: v.sku.trim(),
      product_id: p.product_id,
      variant_id: v.variant_id,
      name: fullName,
      slug: p.slug,
      description: p.long_description,
      short_description: p.short_description,
      brand: p.brand?.brand_name ?? null,
      categories,
      primary_category: primaryCategory,
      sku: v.sku.trim(),
      barcode: v.barcode?.trim() || null,
      weight_grams: v.weight_grams ? Number(v.weight_grams) : null,
      price: Number.isFinite(listPrice) ? (listPrice as number) : null,
      cost_price: Number.isFinite(costPrice) ? (costPrice as number) : null,
      currency,
      image: variantPrimary ?? parentPrimaryImage,
      images: recordImages,
      in_stock: !!(p.is_active && v.is_active),
      is_active: !!v.is_active,
    });
  }
  return records;
}

