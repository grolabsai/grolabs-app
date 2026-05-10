/**
 * Type definitions for Scout's search infrastructure.
 *
 * Per docs/policy/search-foundations.md.
 *
 * Stage 0 (this PR) only needs types for the meilisearch_client module's
 * public surface and the token endpoint's request/response. The full
 * ScoutSearchDocument shape lands with Stage 1's document builder.
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
