/**
 * Shared facets contract for the search proxy and the in-Scout emulator.
 *
 * Per docs/policy/search-foundations.md §7 (facets amendment) + §17. The
 * allowlist + filter builder live here so the public `/api/v1/search` and
 * the emulator server action cannot drift on quoting, escaping, or which
 * fields are facetable.
 */

/**
 * Facet names callers may request. Must remain a subset of the index's
 * `filterableAttributes` (see meilisearch-client.DEFAULT_INDEX_SETTINGS) —
 * Meilisearch returns an error if you facet on a non-filterable attribute.
 *
 * Scoped narrowly on purpose: a tenant should not be able to facet on
 * arbitrary string fields, both for perf (high-cardinality fields blow up
 * the response) and to keep the contract a small, audited list.
 *
 * Membership only — order is asserted separately by `FACET_RENDER_ORDER`.
 */
export const FACET_ALLOWLIST: readonly string[] = [
  "brand",
  "category_ids",
  "in_stock",
  "price",
  "scout_attributes.species",
  "scout_attributes.lifestage",
];

/**
 * Deliberate render order for the emulator facet rail (and any other UI
 * surface that consumes the facets contract). Price and brand lead because
 * they're the dominant deciding factors in shopper research; remaining
 * attribute facets follow in priority order; the in-stock availability
 * toggle is last as visual punctuation.
 *
 * TODO(dynamic-attribute-facets): when per-attribute facets become driven
 * by the catalog's `product_attribute` rows (indexed via the document
 * builder + added to `filterableAttributes` per-instance), this static
 * ordering should give way to `category_product_attribute.form_order` for
 * the attribute slice — price + brand stay pinned to the top, in_stock
 * stays at the bottom, the middle becomes data-driven.
 */
export const FACET_RENDER_ORDER: readonly string[] = [
  "price",
  "brand",
  "scout_attributes.species",
  "scout_attributes.lifestage",
  "in_stock",
];

const FACET_ALLOWSET = new Set(FACET_ALLOWLIST);

/** Drop any requested facet that isn't in the allowlist. */
export function sanitizeFacets(requested: unknown): string[] {
  if (!Array.isArray(requested)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of requested) {
    if (typeof v !== "string") continue;
    if (!FACET_ALLOWSET.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ── Filter builder ───────────────────────────────────────────────────────

/** A single filter clause built from the emulator's facet UI. Keep this
 * shape narrow — the public proxy still accepts a raw `filters` string for
 * advanced callers; this is only for the in-Scout facet rail. */
export type FacetFilter =
  | { kind: "in"; attribute: string; values: string[] }
  | { kind: "in_numeric"; attribute: string; values: number[] }
  | { kind: "boolean"; attribute: string; value: boolean }
  | { kind: "range"; attribute: string; min: number | null; max: number | null };

/** Quote a string value for Meilisearch's filter DSL. Wraps in double quotes
 * and escapes backslash + double-quote. Meilisearch's grammar accepts this
 * everywhere a string literal is allowed. */
function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a list of facet filters as a single Meilisearch filter expression.
 * Returns `null` when there are no usable clauses (so callers can decide
 * how to merge with an external `filters` string).
 *
 * - Multiple clauses are AND-joined (intra-facet OR is handled by `IN`).
 * - Empty `values` arrays drop the clause entirely — selecting zero values
 *   is the same as not filtering on that facet.
 */
export function buildMeilisearchFilter(filters: FacetFilter[]): string | null {
  const parts: string[] = [];
  for (const f of filters) {
    switch (f.kind) {
      case "in": {
        if (f.values.length === 0) break;
        parts.push(`${f.attribute} IN [${f.values.map(quoteString).join(", ")}]`);
        break;
      }
      case "in_numeric": {
        if (f.values.length === 0) break;
        parts.push(`${f.attribute} IN [${f.values.join(", ")}]`);
        break;
      }
      case "boolean": {
        parts.push(`${f.attribute} = ${f.value ? "true" : "false"}`);
        break;
      }
      case "range": {
        if (f.min == null && f.max == null) break;
        if (f.min != null && f.max != null) {
          parts.push(`${f.attribute} ${f.min} TO ${f.max}`);
        } else if (f.min != null) {
          parts.push(`${f.attribute} >= ${f.min}`);
        } else if (f.max != null) {
          parts.push(`${f.attribute} <= ${f.max}`);
        }
        break;
      }
    }
  }
  return parts.length > 0 ? parts.join(" AND ") : null;
}
