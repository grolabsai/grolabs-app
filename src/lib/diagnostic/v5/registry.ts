/**
 * Prospectos v5 — scorer registry.
 *
 * A typed dispatch table: `check_code → Scorer`. This mirrors the legacy
 * `SCORERS` object in `src/lib/diagnostic/scorers.ts`, but is populated by
 * side-effecting `register(...)` calls from the per-category scorer files in
 * `./scorers/*` so coverage is visible one line per check.
 *
 * Listing the 55 codes here is the dispatch table, NOT a rubric — weights,
 * deps, and set membership still come from the DB (loader.ts). A code with no
 * registered scorer resolves to `undefined`; the future engine writes `'na'`
 * for it, exactly as the legacy runner does for unknown codes.
 *
 * Prompts 4–5 replace the `notImplemented` stubs with real scorers in place.
 *
 * NOTE: `getScorer`/`registeredCheckCodes` are only meaningful after the
 * `./scorers` barrel has been imported (which runs the registrations). Import
 * this module via `@/lib/diagnostic/v5` (index.ts), which pulls in the barrel.
 */

import type { ScoreResult, Scorer } from "./types";

const registry = new Map<string, Scorer>();

/** Register a scorer for a check code. A later call overrides an earlier one. */
export function register(checkCode: string, scorer: Scorer): void {
  registry.set(checkCode, scorer);
}

/** Look up the scorer for a check code, or `undefined` if none is registered. */
export function getScorer(checkCode: string): Scorer | undefined {
  return registry.get(checkCode);
}

/** All registered check codes (order not guaranteed). */
export function registeredCheckCodes(): string[] {
  return [...registry.keys()];
}

/**
 * Shared placeholder scorer. Returns a not-measured result so a check with no
 * real implementation yet is visibly skipped rather than silently dropped.
 * Real scorers (Prompts 4–5) replace the per-code registrations that use this.
 */
export const notImplemented: Scorer = async (): Promise<ScoreResult> => ({
  score: null,
  status: "na",
  note: "not_implemented",
});
