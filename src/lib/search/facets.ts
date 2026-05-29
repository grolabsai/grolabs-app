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
 * Sentinel value in `FACET_RENDER_ORDER` that marks the slot where dynamic
 * per-attribute facets should be rendered. Not a real Meilisearch facet
 * name — the UI explodes it into a sequence of `attributes.<code>` blocks
 * driven by `category_product_attribute.form_order` (when a category is
 * picked) or `attribute_name` (when none is). Kept as a string sentinel so
 * the ordering constant stays the single source of truth for slot order.
 */
export const FACET_DYNAMIC_ATTRIBUTES_SENTINEL = "_dynamic_attributes";

/**
 * Deliberate render order for the emulator facet rail (and any other UI
 * surface that consumes the facets contract). Price and brand lead because
 * they're the dominant deciding factors in shopper research; the dynamic
 * attribute facets follow (in the merchant's `form_order` for the active
 * category); legacy scout_attributes.* slots come after; the in-stock
 * toggle anchors the bottom as visual punctuation.
 */
export const FACET_RENDER_ORDER: readonly string[] = [
  "price",
  "brand",
  FACET_DYNAMIC_ATTRIBUTES_SENTINEL,
  "scout_attributes.species",
  "scout_attributes.lifestage",
  "in_stock",
];

const FACET_ALLOWSET = new Set(FACET_ALLOWLIST);

/**
 * Dynamic per-attribute facets land under `attributes.<code>` where `<code>`
 * is a `product_attribute.attribute_code`. We let any name matching that
 * shape through — the worst case is a 400 from Meilisearch when the code
 * doesn't exist in `filterableAttributes`, not a security boundary breach.
 * `code` must be lowercase ASCII identifier-ish so a typo can't pull in a
 * weird path traversal value.
 */
const DYNAMIC_FACET_RE = /^attributes\.[a-z0-9_]+$/;

/** Drop any requested facet that isn't in the allowlist (static or dynamic). */
export function sanitizeFacets(requested: unknown): string[] {
  if (!Array.isArray(requested)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of requested) {
    if (typeof v !== "string") continue;
    const allowed = FACET_ALLOWSET.has(v) || DYNAMIC_FACET_RE.test(v);
    if (!allowed) continue;
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
