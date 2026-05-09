/**
 * Heuristics that turn a list of spreadsheet column headers into suggested
 * mappings for the pricing import wizard. The user can always override what
 * we suggest — these are just a head start.
 *
 * Detection is keyword-based and locale-aware (Spanish first, English second
 * because most provider price lists in the target market are in Spanish).
 * We strip accents and lowercase before matching so "código" and "Codigo"
 * land in the same bucket.
 */

export type KeyColumnKind = "barcode" | "sku" | "provider_sku";

export type ColumnKind = KeyColumnKind | "cost" | "suggested_price";

export type ColumnSuggestions = {
  /** Index of the column we think holds the matching key (barcode/sku). */
  keyColumnIndex: number | null;
  /** Best guess at *what* the key column contains. Drives variant matching. */
  keyKind: KeyColumnKind | null;
  /** Index of the column that holds the unit cost. */
  costColumnIndex: number | null;
  /** Index of the column that holds the manufacturer's suggested price. */
  suggestedPriceColumnIndex: number | null;
};

/**
 * Patterns ordered most-specific → least-specific. The first match wins per
 * column, so e.g. "Costo" beats a generic "Precio" header for the cost slot.
 *
 * Each pattern is matched against the lowercased + accent-stripped header.
 * Word boundaries are loose on purpose — provider sheets use lots of
 * punctuation ("Cód. Prov.", "Precio s/IVA").
 */
const PATTERNS: Record<ColumnKind, RegExp[]> = {
  barcode: [
    /\b(barcode|bar code)\b/,
    /codigo de barras|cod barras|cod\.? barras/,
    /\bean\b/,
    /\bupc\b/,
    /\bgtin\b/,
  ],
  provider_sku: [
    /codigo (?:de )?proveedor|cod\.? prov/,
    /provider (?:sku|code)/,
    /supplier (?:sku|code)/,
    /referencia (?:proveedor|prov)/,
    /\bsku prov\b/,
  ],
  sku: [
    /\bsku\b/,
    /codigo interno|cod interno|cod\.? int/,
    /codigo articulo|cod\.? art/,
    // Bare "codigo" only matches if no more specific cod-* pattern hit.
    /\bcodigo\b/,
    /\bclave\b/,
  ],
  cost: [
    /\bcosto\b/,
    /\bcost\b/,
    /precio costo|precio de costo/,
    /precio neto|precio compra/,
    /precio s\/?iva|precio sin iva/,
    /unit cost/,
  ],
  suggested_price: [
    /precio sugerido/,
    /sugerido/,
    /\bpvp\b/,
    /\bmsrp\b/,
    /precio publico|precio al publico/,
    /precio venta sugerid/,
    /retail price/,
    /precio lista/, // last; some sheets call cost "precio lista"
  ],
};

function normaliseHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .trim();
}

function matchKind(header: string, kind: ColumnKind): boolean {
  const norm = normaliseHeader(header);
  return PATTERNS[kind].some((re) => re.test(norm));
}

/**
 * Inspect the headers and return our best guess for each mapping slot.
 * No header is consumed by more than one slot — once a column is claimed
 * for, say, cost, it can't also be the suggested-price column.
 */
export function suggestColumns(headers: string[]): ColumnSuggestions {
  const claimed = new Set<number>();

  function findFirst(kind: ColumnKind): number | null {
    for (let i = 0; i < headers.length; i++) {
      if (claimed.has(i)) continue;
      if (matchKind(headers[i], kind)) {
        claimed.add(i);
        return i;
      }
    }
    return null;
  }

  // Try the most specific key kinds before the generic "sku".
  let keyKind: KeyColumnKind | null = null;
  let keyColumnIndex: number | null = null;

  const barcodeIdx = findFirst("barcode");
  if (barcodeIdx !== null) {
    keyKind = "barcode";
    keyColumnIndex = barcodeIdx;
  } else {
    const provIdx = findFirst("provider_sku");
    if (provIdx !== null) {
      keyKind = "provider_sku";
      keyColumnIndex = provIdx;
    } else {
      const skuIdx = findFirst("sku");
      if (skuIdx !== null) {
        keyKind = "sku";
        keyColumnIndex = skuIdx;
      }
    }
  }

  const costColumnIndex = findFirst("cost");
  const suggestedPriceColumnIndex = findFirst("suggested_price");

  return {
    keyColumnIndex,
    keyKind,
    costColumnIndex,
    suggestedPriceColumnIndex,
  };
}
