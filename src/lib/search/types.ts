/**
 * Type definitions for GroLabs's search infrastructure.
 *
 * Per docs/policy/search-foundations.md.
 *
 * Stage 0 (this PR) only needs types for the meilisearch_client module's
 * public surface and the token endpoint's request/response. The full
 * RreSearchDocument shape lands with Stage 1's document builder.
 */

/** Naming convention: per-instance Meilisearch index for instance N is `inst_N`. */
export function indexUidFor(instanceId: number): string {
  return `inst_${instanceId}`;
}

/** Token endpoint request body. instance_id is a number — see CLAUDE.md §2. */
export type TokenRequest = {
  instance_id: number;
};

/** Token endpoint success response. Cache-Control: no-store on the wire. */
export type TokenResponse = {
  token: string;
  expires_at: number; // unix seconds
  meilisearch_host: string;
  index_uid: string;
};

/** Generic 403 body shared by all auth/origin failures (no enumeration). */
export type TokenErrorResponse = {
  error: "instance_not_found_or_origin_not_authorized";
};

/** Health probe result returned by `meilisearchClient.ping()`. */
export type MeilisearchHealth = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

// ── Stage 1: Document schema ──────────────────────────────────────────────
//
// Per docs/policy/search-foundations.md §4.

/** A single variant inside `RreSearchDocument.variants[]`.
 *
 * `attributes` keys MUST be slugs (e.g. `pa_size`, not `Tamaño`). Per the
 * locked contract in PR #68 (plugin v0.2 consumer): keys come from the WC
 * taxonomy slug; values stay as the human-readable option label.
 */
export type RreSearchVariant = {
  variation_id: number;
  sku: string | null;
  attributes: Record<string, string>;
  price: number | null;
  sale_price: number | null;
  in_stock: boolean;
  stock_quantity: number | null;
  image_url: string | null;
};

export type VariationSummaryType = "simple" | "variable_single" | "variable_multi";

export type VariationSummary = {
  type: VariationSummaryType;
  purchasable_variation_count: number;
  default_variation_id: number | null;
  default_variation_sku: string | null;
  price_range: { min: number | null; max: number | null };
  in_stock_summary: { any_in_stock: boolean; all_in_stock: boolean };
};

export type RreAttributes = {
  species: string[];
  lifestage: string[];
  breed_compatibility: string[];
  size: string | null;
  weight_grams: number | null;
  food_type: string | null;
  medical_conditions: string[];
  age_min_months: number | null;
  age_max_months: number | null;
};

/** The full document indexed in Meilisearch. Per §4. */
export type RreSearchDocument = {
  id: number;
  instance_id: number;
  woocommerce_id: number | null;

  name: string;
  slug: string;
  description: string;
  short_description: string;
  url: string;
  image_url: string | null;
  thumbnail_url: string | null;

  categories: string[];
  category_ids: number[];
  tags: string[];
  brand: string | null;

  scout_attributes: RreAttributes;
  /** Dynamic per-attribute block — value array per `product_attribute.attribute_code`
   * for list-type attributes marked `is_filterable = true`. Drives the
   * dynamic facet rail in the emulator and (when the WP plugin opts in)
   * the storefront. v1 indexes list-type only; quantity/text/number facets
   * are a follow-up. See document-builder.ts for the projection rules. */
  attributes: Record<string, string[]>;
  variation_summary: VariationSummary;
  variants: RreSearchVariant[];

  price: number | null;
  sale_price: number | null;
  currency: string;
  in_stock: boolean;
  sku: string | null;

  popularity: number;
  created_at: string;
  updated_at: string;
  indexed_at: string;
  _schema_version: 1;
};

// ── Stage 1: Search proxy request/response ────────────────────────────────
//
// Per docs/policy/search-foundations.md §7.

export type SearchRequest = {
  instance_id: number;
  query: string;
  limit?: number;
  offset?: number;
  filters?: string;
  sort?: string[];
  /** Facet names to request distributions for. Server gates against the
   * allowlist in `src/lib/search/facets.ts`; unknown names are silently
   * dropped. Omit or pass `[]` to skip facet computation. */
  facets?: string[];
};

/** Per the PR #68 contract: matched_variation is a full variant object,
 * not a reference. Same shape as `document.variants[]` entries. */
export type MatchedVariation = RreSearchVariant;

export type SearchHit = {
  document: RreSearchDocument;
  matched_variation: MatchedVariation | null;
  _score?: number;
};

export type SearchResponse = {
  hits: SearchHit[];
  total_hits: number;
  processing_time_ms: number;
  /**
   * Meilisearch's analytics query identifier. Empty string when Meilisearch
   * did not return metadata (e.g. analytics disabled on the cluster). The
   * storefront reports click events against `metadata.queryUid`; this
   * top-level field is kept as a backwards-compatible alias.
   */
  query_uid: string;
  /**
   * Meilisearch analytics metadata, surfaced so the storefront can attribute
   * click events to the exact query. `requestUid` and `indexUid` are included
   * for future event/relevancy work and are cheap to pass through.
   */
  metadata: {
    queryUid: string;
    requestUid: string;
    indexUid: string;
  };
  /** Per-facet value → count map. Only emitted when the request included a
   * non-empty `facets[]`. Counts respect any active `filters` (restrictive,
   * Meilisearch default). See policy §7 facets amendment + §17. */
  facets?: Record<string, Record<string, number>>;
  /** Per-facet min/max stats for numeric facets (currently: `price`).
   * Absent when no numeric facet was requested or returned. */
  facet_stats?: Record<string, { min: number; max: number }>;
};
