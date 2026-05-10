/**
 * Internal shapes for the WooCommerce → Scout import (v1).
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
