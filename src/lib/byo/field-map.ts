/**
 * Field mapping (Stage 3) — infer which merchant field names map to our canonical
 * ProductObject fields, and apply that map with light type coercion. Pure, no AI.
 *
 * This is what unlocks unstructured/"whatever" data: a merchant's `sku` / `Nombre`
 * / `Marca` / `Precio` become canonical `id` / `title` / `brand` / `price`, so the
 * canonical-field stages (validate, interpret, variant grouping) can run. Mirrors
 * the UI wizard's keyword auto-mapper (src/lib/import/step4-automap.ts), targeted
 * at the canonical object + multilingual (en/es) synonyms.
 *
 * Inference is a proposal — the confirm step (P6) lets a human correct it before
 * it's saved to import_job.column_mapping and applied to the whole batch.
 */

export type CanonicalField =
  | "id"
  | "title"
  | "brand"
  | "price"
  | "category"
  | "image"
  | "description"
  | "in_stock";

const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  id: ["id", "sku", "product_id", "productid", "codigo", "code", "ref", "reference", "item_code", "handle"],
  title: ["title", "name", "nombre", "product_name", "productname", "titulo", "producto"],
  brand: ["brand", "marca", "manufacturer", "fabricante", "vendor"],
  price: ["price", "precio", "list_price", "precio_lista", "pvp", "amount", "cost", "costo"],
  category: ["category", "categories", "categoria", "categorias", "category_name", "rubro", "department", "departamento"],
  image: ["image", "image_url", "imageurl", "imagen", "foto", "photo", "picture", "thumbnail"],
  description: ["description", "descripcion", "desc", "details", "detalles"],
  in_stock: ["in_stock", "instock", "stock", "disponible", "available", "availability", "existencia"],
};

const CANONICAL_ORDER = Object.keys(FIELD_SYNONYMS) as CanonicalField[];

export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, " ")
    .trim();
}

/** Lower is better; Infinity = no match. Exact synonym match beats substring. */
function matchScore(col: string, synonyms: string[]): number {
  let best = Infinity;
  for (let j = 0; j < synonyms.length; j++) {
    const kw = synonyms[j];
    if (col === kw) best = Math.min(best, j);
    else if (col.includes(kw) || kw.includes(col)) best = Math.min(best, j + 100);
  }
  return best;
}

export type FieldMapping = { source: string; target: CanonicalField };

export type InferredMap = {
  mapping: FieldMapping[];
  /** Raw fields we could not map (e.g. variant axes like "Talla", or extras). */
  unmapped: string[];
};

/** Infer a field map from a sample of records (the union of their keys). */
export function inferFieldMap(records: Record<string, unknown>[]): InferredMap {
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      // skip structural nests — they're handled by stitch, not field mapping
      if (k === "variants" || k === "attributes") continue;
      seen.add(k);
    }
  }
  const fields = [...seen];
  const normalized = new Map(fields.map((f) => [f, normalizeKey(f)]));

  const mapping: FieldMapping[] = [];
  const usedSources = new Set<string>();

  for (const target of CANONICAL_ORDER) {
    const synonyms = FIELD_SYNONYMS[target];
    let bestSource: string | null = null;
    let bestScore = Infinity;
    for (const f of fields) {
      if (usedSources.has(f)) continue;
      const score = matchScore(normalized.get(f) ?? "", synonyms);
      if (score < bestScore) {
        bestScore = score;
        bestSource = f;
      }
    }
    if (bestSource !== null && bestScore !== Infinity) {
      mapping.push({ source: bestSource, target });
      usedSources.add(bestSource);
    }
  }

  const unmapped = fields.filter((f) => !usedSources.has(f));
  return { mapping, unmapped };
}

/** Parse a loosely-formatted number: "89,90" → 89.9, "1.234,56" → 1234.56, "$12.00" → 12. */
export function parseLooseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[^\d.,-]/g, "");
  if (s === "") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // the last-occurring separator is the decimal one
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseLooseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v !== "string") return null;
  const s = normalizeKey(v);
  if (["true", "1", "yes", "y", "si", "in stock", "instock", "disponible", "available"].includes(s)) return true;
  if (["false", "0", "no", "n", "out of stock", "agotado", "unavailable"].includes(s)) return false;
  return null;
}

function coerce(target: CanonicalField, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (target === "price") return parseLooseNumber(value) ?? value;
  if (target === "in_stock") return parseLooseBool(value) ?? value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value; // id/title/brand/category/image/description kept as-is (string)
}

/** Apply a field map to one record → canonical fields + any unmapped fields kept verbatim. */
export function applyFieldMap(
  record: Record<string, unknown>,
  mapping: FieldMapping[],
): Record<string, unknown> {
  const sources = new Set(mapping.map((m) => m.source));
  const out: Record<string, unknown> = {};
  // keep everything that isn't a mapped source, verbatim (lossless)
  for (const [k, v] of Object.entries(record)) {
    if (!sources.has(k)) out[k] = v;
  }
  for (const { source, target } of mapping) {
    if (record[source] !== undefined) out[target] = coerce(target, record[source]);
  }
  return out;
}
