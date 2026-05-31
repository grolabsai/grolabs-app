/**
 * Pure variant-selection logic for the /api/v1/search proxy.
 *
 * Per docs/policy/search-foundations.md §7. Per the PR #68 contract: this
 * function returns a FULL variant object (or null), not a reference.
 *
 *   - simple            → null (card uses document's top-level fields)
 *   - variable_single   → the one purchasable variation
 *   - variable_multi    → in-stock variant with the most _matchesPosition
 *                         matches, falling back to default_variation_id (if
 *                         in stock), then first in-stock variant, then null.
 *
 * STAGE 1 STATUS: the variable_multi branch is stubbed — it skips the
 * _matchesPosition counting step and goes straight to the default-id /
 * first-in-stock fallback. Tuncho is verifying the exact response field
 * name from Meilisearch (showMatchesPosition response shape varies by SDK
 * version). Once confirmed, replace the stub with the real counting logic
 * — see TODO below.
 */

import type { RreSearchDocument, RreSearchVariant } from "./types";

/** Shape of `_matchesPosition` we expect Meilisearch to return when
 * `showMatchesPosition: true` is set on the search request.
 *
 * Keys are the matched attribute paths (e.g. `name`, `variants.attributes.pa_size`,
 * `variants.0.sku`). Values are arrays of `{ start, length }` (chars). The
 * exact shape for nested-array fields is what Tuncho is verifying against
 * a live response.
 *
 * TODO(matchesPosition): replace `unknown` with a concrete type after
 * confirmation.
 */
export type MatchesPosition = Record<string, unknown>;

/**
 * Pick the variant that best satisfies the query for one search hit.
 *
 * Returns the full `RreSearchVariant` object (matching `document.variants[]`
 * shape exactly per PR #68), or null when no variant should be highlighted
 * (simple products, or variable_multi with no in-stock variants at all).
 */
export function pickMatchedVariation(
  document: RreSearchDocument,
  matchesPosition: MatchesPosition | undefined
): RreSearchVariant | null {
  const summary = document.variation_summary;

  if (summary.type === "simple") return null;

  if (summary.type === "variable_single") {
    // The one purchasable variant. If for some reason none are purchasable
    // (raced stock state), fall back to the first variant; the card UI
    // surfaces the out-of-stock badge.
    const purchasable = document.variants.find((v) => v.in_stock);
    return purchasable ?? document.variants[0] ?? null;
  }

  // variable_multi
  // ─────────────────────────────────────────────────────────────────────
  // STUB. Per the implementation prompt, we skip _matchesPosition parsing
  // until the response shape is confirmed. Real algorithm:
  //
  //   1. For each key in matchesPosition that targets a variant subpath
  //      (e.g. `variants.<i>.sku`, `variants.<i>.attributes.<slug>`),
  //      bump a counter for variant index `i`.
  //   2. Pick the in-stock variant index with the highest counter.
  //   3. If no variant-specific matches, fall through to defaults below.
  //
  // TODO(matchesPosition): implement steps 1-2 once Tuncho confirms the
  // exact key format Meilisearch emits for nested-array matches.
  void matchesPosition;

  // Fallback chain per §7.
  const byDefault =
    summary.default_variation_id != null
      ? document.variants.find(
          (v) => v.variation_id === summary.default_variation_id && v.in_stock
        )
      : undefined;
  if (byDefault) return byDefault;

  const firstInStock = document.variants.find((v) => v.in_stock);
  if (firstInStock) return firstInStock;

  return null;
}
