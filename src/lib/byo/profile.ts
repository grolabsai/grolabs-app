/**
 * Data profile / overview of a session's product objects (Stage 2 — totals).
 *
 * Pure counting, NO AI, NO field-name guessing — the macro reconciliation a
 * merchant uses to confirm "yes, this is my catalog" before any per-product
 * work: product/variant counts, field coverage (% populated), and value
 * distributions for categorical fields (which auto-surface brands, categories,
 * statuses, sizes, etc. without hardcoding field names).
 *
 * High-cardinality fields (id, sku, title, description — near-unique) are
 * excluded from distributions; their populated % still shows in field coverage.
 */

export type FieldStat = { name: string; populated: number; total: number; pct: number };
export type Distribution = {
  field: string;
  distinct: number;
  /** True when more distinct values exist than `top` shows. */
  truncated: boolean;
  top: { value: string; count: number }[];
};
export type ProfileResult = {
  products: number;
  variants: number;
  fields: FieldStat[];
  distributions: Distribution[];
};

const DEFAULT_TOP_N = 25;
/** Skip a field from distributions once it has this many distinct values (free text). */
const DISTINCT_HARD_CAP = 2000;
/** Skip a field that looks like a unique key (distinct / total above this). */
const UNIQUE_RATIO = 0.9;

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Flatten a value into the scalar facet values it contributes (objects skipped). */
function toFacetValues(v: unknown): string[] {
  if (typeof v === "string") return v.length > 0 ? [v] : [];
  if (typeof v === "number" || typeof v === "boolean") return [String(v)];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string" && item.length > 0) out.push(item);
      else if (typeof item === "number" || typeof item === "boolean") out.push(String(item));
      // objects (nested variants / category refs) are not scalar facets
    }
    return out;
  }
  return [];
}

export function profileProducts(
  products: Record<string, unknown>[],
  opts?: { topN?: number },
): ProfileResult {
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  const total = products.length;

  const populated = new Map<string, number>();
  const tally = new Map<string, Map<string, number>>();
  let variants = 0;

  for (const p of products) {
    if (Array.isArray(p.variants)) variants += p.variants.length;
    for (const [key, value] of Object.entries(p)) {
      // 'variants' and 'attributes' are structural nests, not scalar facets
      if (key === "variants" || key === "attributes") continue;
      if (!isEmpty(value)) populated.set(key, (populated.get(key) ?? 0) + 1);
      for (const fv of toFacetValues(value)) {
        let m = tally.get(key);
        if (!m) {
          m = new Map();
          tally.set(key, m);
        }
        m.set(fv, (m.get(fv) ?? 0) + 1);
      }
    }
  }

  const fields: FieldStat[] = [...populated.entries()]
    .map(([name, pop]) => ({
      name,
      populated: pop,
      total,
      pct: total > 0 ? Math.round((pop / total) * 100) : 0,
    }))
    .sort((a, b) => b.populated - a.populated);

  const distributions: Distribution[] = [];
  for (const [field, m] of tally) {
    const distinct = m.size;
    if (distinct === 0 || distinct > DISTINCT_HARD_CAP) continue;
    // skip near-unique fields (ids, names, free text)
    if (total > 1 && distinct / total > UNIQUE_RATIO) continue;
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    distributions.push({
      field,
      distinct,
      truncated: distinct > topN,
      top: sorted.slice(0, topN).map(([value, count]) => ({ value, count })),
    });
  }
  // most "useful to validate" first: fewest distinct (cleanest facets) on top
  distributions.sort((a, b) => a.distinct - b.distinct);

  return { products: total, variants, fields, distributions };
}
