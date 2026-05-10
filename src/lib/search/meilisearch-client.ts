import { Meilisearch, MeilisearchApiError } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";
import { indexUidFor, type MeilisearchHealth } from "./types";

/**
 * The single place in Scout's codebase that holds the Meilisearch master key.
 *
 * Per docs/policy/search-foundations.md §5. Module-scoped singleton with a
 * lazily-created parent search key for tenant-token signing.
 *
 * Env vars:
 *   MEILISEARCH_HOST         — project URL, e.g. https://ms-xxxx.meilisearch.io
 *   MEILISEARCH_MASTER_KEY   — admin master key (server only, never logged)
 *
 * Stage 0 callers:
 *   - /api/v1/search/token route — generateTenantToken
 *   - /configuration/search admin page — ping, ensureIndex
 *
 * Stage 1 will add document upserts, deletes, search, settings updates.
 */

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Index settings applied at creation. Per docs/policy/search-foundations.md §3.
 *
 * `instance_id` MUST be in filterableAttributes — every tenant token includes
 * an `instance_id = N` filter as defense-in-depth.
 *
 * Stage 5 lets merchants override per-instance; for now these are the defaults
 * for every newly-created index.
 */
export const DEFAULT_INDEX_SETTINGS = {
  searchableAttributes: [
    "name",
    "brand",
    "categories",
    "description",
    "variants.attributes",
    "variants.sku",
    "scout_attributes.lifestage",
    "scout_attributes.species",
    "scout_attributes.breed_compatibility",
    "scout_attributes.medical_conditions",
  ],
  filterableAttributes: [
    "instance_id",
    "category_ids",
    "brand",
    "in_stock",
    "scout_attributes.species",
    "scout_attributes.lifestage",
    "price",
  ],
  sortableAttributes: ["price", "created_at", "popularity"],
  rankingRules: [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "popularity:desc",
  ],
  stopWords: ["el", "la", "los", "las", "un", "una", "de", "del", "para", "con", "y", "o"],
  synonyms: {
    comida: ["alimento", "kibble"],
    alimento: ["comida", "kibble"],
    kibble: ["comida", "alimento"],
    perro: ["can"],
    can: ["perro"],
    gato: ["felino"],
    felino: ["gato"],
  },
  pagination: { maxTotalHits: 1000 },
  faceting: { maxValuesPerFacet: 100 },
};

const TENANT_TOKEN_PARENT_KEY_NAME = "scout-tenant-token-parent";
const DEFAULT_TOKEN_TTL_SECONDS = 15 * 60;

// ── Singleton client ──────────────────────────────────────────────────────────

let cached: Meilisearch | null = null;

function getClient(): Meilisearch {
  if (cached) return cached;
  const host = process.env.MEILISEARCH_HOST;
  const apiKey = process.env.MEILISEARCH_MASTER_KEY;
  if (!host || !apiKey) {
    throw new MeilisearchConfigError(
      "MEILISEARCH_HOST and MEILISEARCH_MASTER_KEY must both be set in the environment."
    );
  }
  cached = new Meilisearch({ host, apiKey });
  return cached;
}

export function meilisearchHost(): string {
  const host = process.env.MEILISEARCH_HOST;
  if (!host) throw new MeilisearchConfigError("MEILISEARCH_HOST is not set.");
  return host;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class MeilisearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeilisearchConfigError";
  }
}

export class MeilisearchOpError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MeilisearchOpError";
    this.cause = cause;
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function ping(): Promise<MeilisearchHealth> {
  const start = Date.now();
  try {
    const client = getClient();
    const h = await client.health();
    return {
      ok: h.status === "available",
      status: h.status === "available" ? 200 : 503,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      status: err instanceof MeilisearchApiError ? err.response.status : 0,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ── Index lifecycle ───────────────────────────────────────────────────────────

export async function indexExists(instanceId: number): Promise<boolean> {
  const client = getClient();
  try {
    await client.getIndex(indexUidFor(instanceId));
    return true;
  } catch (err) {
    if (err instanceof MeilisearchApiError && err.response.status === 404) return false;
    throw new MeilisearchOpError(`indexExists(${instanceId}) failed`, err);
  }
}

/**
 * Idempotent: creates the index if missing, applies default settings either way.
 * Returns the index UID. Used by the admin connection panel and by Stage 1's
 * push pipeline before the first upsert for a new instance.
 */
export async function ensureIndex(instanceId: number): Promise<string> {
  const client = getClient();
  const uid = indexUidFor(instanceId);
  try {
    if (!(await indexExists(instanceId))) {
      await client.createIndex(uid, { primaryKey: "id" });
    }
    await client.index(uid).updateSettings(DEFAULT_INDEX_SETTINGS);
    return uid;
  } catch (err) {
    throw new MeilisearchOpError(`ensureIndex(${instanceId}) failed`, err);
  }
}

export async function deleteIndex(instanceId: number): Promise<void> {
  const client = getClient();
  try {
    await client.deleteIndex(indexUidFor(instanceId));
  } catch (err) {
    if (err instanceof MeilisearchApiError && err.response.status === 404) return;
    throw new MeilisearchOpError(`deleteIndex(${instanceId}) failed`, err);
  }
}

// ── Tenant tokens ─────────────────────────────────────────────────────────────

let parentKeyCache: { uid: string; key: string } | null = null;

/**
 * Find or create the search-scoped API key Scout uses as the parent for all
 * tenant tokens. Identified by name; results cached in module scope.
 *
 * Tenant tokens inherit the parent's permissions, so this key is intentionally
 * scoped to `actions: ['search']` only — never admin-level. Cleaner blast
 * radius than minting tokens with the master key directly.
 */
async function getOrCreateParentSearchKey(): Promise<{ uid: string; key: string }> {
  if (parentKeyCache) return parentKeyCache;
  const client = getClient();
  try {
    const { results } = await client.getKeys({ limit: 100 });
    const existing = results.find((k) => k.name === TENANT_TOKEN_PARENT_KEY_NAME);
    if (existing) {
      parentKeyCache = { uid: existing.uid, key: existing.key };
      return parentKeyCache;
    }
    const created = await client.createKey({
      name: TENANT_TOKEN_PARENT_KEY_NAME,
      description: "Parent key for Scout tenant tokens. Search-only.",
      actions: ["search"],
      indexes: ["*"],
      expiresAt: null,
    });
    parentKeyCache = { uid: created.uid, key: created.key };
    return parentKeyCache;
  } catch (err) {
    throw new MeilisearchOpError("getOrCreateParentSearchKey failed", err);
  }
}

/**
 * Mint a short-lived tenant token scoped to one instance's index, with a
 * defense-in-depth `instance_id = N` filter.
 *
 * Per docs/policy/search-foundations.md §5: filter value is unquoted because
 * instance_id is numeric in Meilisearch's filter DSL.
 */
export async function generateInstanceTenantToken(
  instanceId: number,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): Promise<{ token: string; expiresAt: number; indexUid: string }> {
  const parent = await getOrCreateParentSearchKey();
  const indexUid = indexUidFor(instanceId);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  try {
    const token = await generateTenantToken({
      apiKey: parent.key,
      apiKeyUid: parent.uid,
      searchRules: {
        [indexUid]: { filter: `instance_id = ${instanceId}` },
      },
      expiresAt: new Date(expiresAt * 1000),
    });
    return { token, expiresAt, indexUid };
  } catch (err) {
    throw new MeilisearchOpError(`generateInstanceTenantToken(${instanceId}) failed`, err);
  }
}

// ── Test seam ─────────────────────────────────────────────────────────────────

/**
 * Reset module-scoped caches. For tests and for the admin "reload connection"
 * action — picks up env-var changes without a process restart.
 */
export function _resetClientCache(): void {
  cached = null;
  parentKeyCache = null;
}
