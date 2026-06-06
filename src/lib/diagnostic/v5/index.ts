/**
 * Prospectos v5 — atomic-rubric module (BRIDGE mode, additive).
 *
 * Public entry point. Importing from here guarantees the scorer registry is
 * populated (the `./scorers` barrel runs its `register(...)` side effects).
 *
 * Wiring into a running diagnostic happens in Prompt 6 — nothing here is on a
 * live path yet. Prompt 3 builds the scoring engine on top of `loadAtomicChecks`
 * + `getScorer`; Prompts 4–5 add navigation and real scorers.
 */

import "./scorers"; // side effect: registers all check-code scorers

export * from "./types";
export {
  loadAtomicChecks,
  DEFAULT_PROFILE_CODE,
  type LoadAtomicChecksOptions,
} from "./loader";
export {
  getScorer,
  register,
  registeredCheckCodes,
  notImplemented,
} from "./registry";
