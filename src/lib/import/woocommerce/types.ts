/**
 * Internal shapes for the WooCommerce → GroLabs import (v1).
 * Spec: docs/policy/wc-import.md
 */

export type ImportSummary = {
  total: number;
  upserted: number;
  failed: number;
  durationMs: number;
  errors: ImportError[];
  /** Rows whose slug collided with an existing non-WC row and were renamed. */
  renamedSlugs: Array<{ woocommerceId: number; from: string; to: string }>;
  /** Verbose, structured event log of everything the import did. Surfaced on
   *  the right-side debug pane on /import/woocommerce. Populated for the
   *  products phase (and minimally for categories) so a human can audit
   *  what was created, updated, and linked. */
  debug?: DebugReport;
};

export type DebugReport = {
  phase: "categories" | "products";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  wcSettings?: { weightUnit: string | null; currency: string | null };
  totals: {
    productsProcessed: number;
    productsUpserted: number;
    productsFailed: number;
    productsRenamed: number;
    categoriesUpserted?: number;
    variantsUpserted: number;
    pricingRowsUpserted: number;
    tagsUpserted: number;
    tagLinksWritten: number;
    attributesUpserted: number;
    attributeOptionsUpserted: number;
    variantAttributeRowsUpserted: number;
    categoryAxisFlips: number;
  };
  /** Per-product narrative — what the importer did for each row. Trimmed to
   *  the first 200 entries to keep the JSON column small; total counts above
   *  remain accurate. */
  perProduct: Array<{
    woocommerceId: number;
    name: string;
    productId: number | null;
    variable: boolean;
    variants: Array<{
      wcId: number;
      sku: string | null;
      name: string | null;
      weightGrams: number | null;
    }>;
    variantAxes: Array<{ code: string; name: string; optionsSeen: string[] }>;
    tagsLinked: Array<{ code: string; name: string }>;
    axisFlipsOnCategoryId: number | null;
    pricingRowsWritten: number;
    notes: string[];
  }>;
};

export type ImportError = {
  woocommerceId?: number;
  identifier?: string;
  message: string;
};

export type ImportProgress = {
  /** "categories" | "products" | "idle" */
  phase: "categories" | "products" | "idle";
  /** Current page in WC pagination, 1-based. */
  page: number;
  /** Cumulative count of records processed in this run. */
  processed: number;
  /** Cumulative count of records that succeeded. */
  upserted: number;
  /** Cumulative count of records that failed. */
  failed: number;
  startedAt: string;
};

export type RunResult = {
  ok: boolean;
  jobId: number | null;
  summary: ImportSummary;
  /** When false, populated with a top-level reason (e.g. credentials missing). */
  fatalError?: string;
};
