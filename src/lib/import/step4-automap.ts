import type { ScoutFieldId } from "@/lib/import/types";

/**
 * Lightweight auto-mapper for Step 4. Suggests file-column → Scout-field
 * bindings based on substring keyword matches against normalized column
 * names. Saves the user the obvious work ("barcode" → barcode, "precio"
 * → listPrice, …); they override anything that's wrong by dragging.
 *
 * Intentional simplicity: keyword arrays per field, first match wins.
 * No fuzzy distance, no rank — easy to reason about and to extend when
 * customers introduce new column conventions.
 */

const FIELD_KEYWORDS: Record<ScoutFieldId, string[]> = {
  slug: ["slug", "url_slug", "permalink"],
  shortDescription: [
    "short_description",
    "shortdescription",
    "descripcion_corta",
    "descripcion corta",
    "short_desc",
    "subtitle",
    "tagline",
  ],
  longDescription: [
    "long_description",
    "longdescription",
    "descripcion_larga",
    "descripcion larga",
    "description",
    "descripcion",
    "details",
    "detalles",
  ],
  sku: ["sku", "codigo", "código", "code", "item_code", "item code"],
  barcode: [
    "barcode",
    "ean",
    "upc",
    "gtin",
    "codigo_de_barras",
    "codigo de barras",
    "código de barras",
  ],
  weightGrams: [
    "weight",
    "peso",
    "peso_g",
    "peso_gramos",
    "weight_g",
    "weight_grams",
  ],
  listPrice: [
    "price",
    "precio",
    "list_price",
    "listprice",
    "precio_lista",
    "precio_de_lista",
    "msrp",
  ],
  costPrice: [
    "cost",
    "costo",
    "cost_price",
    "costprice",
    "precio_costo",
    "precio_de_costo",
    "buy_price",
  ],
  stockQty: [
    "stock",
    "qty",
    "quantity",
    "cantidad",
    "existencia",
    "inventory",
    "inventario",
    "on_hand",
  ],
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, " ")
    .trim();
}

/**
 * For each Scout field, return the index of the best-matching file column
 * (first keyword hit in scan order), or null. Skips columns already
 * consumed by another field or by the Step-2 picks.
 */
export function autoMapColumns(
  fileColumns: string[],
  reservedColumnIndices: ReadonlySet<number>,
): Partial<Record<ScoutFieldId, number>> {
  const out: Partial<Record<ScoutFieldId, number>> = {};
  const used = new Set<number>(reservedColumnIndices);
  const normalized = fileColumns.map(normalize);

  // Iterate fields in the canonical order so the first field "wins" a
  // shared keyword (price could go to listPrice or costPrice; listPrice
  // listed first wins).
  for (const field of Object.keys(FIELD_KEYWORDS) as ScoutFieldId[]) {
    const keywords = FIELD_KEYWORDS[field];
    let bestIdx: number | null = null;
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i)) continue;
      const col = normalized[i];
      const hit = keywords.some(
        (kw) => col === kw || col.includes(kw) || kw.includes(col),
      );
      if (hit) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx !== null) {
      out[field] = bestIdx;
      used.add(bestIdx);
    }
  }
  return out;
}
