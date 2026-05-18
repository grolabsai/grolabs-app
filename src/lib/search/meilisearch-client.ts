import { Meilisearch, MeilisearchApiError } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";
import {
  indexUidFor,
  type MeilisearchHealth,
  type ScoutSearchDocument,
} from "./types";

/**
 * The single place in GroLabs's codebase that holds the Meilisearch master key.
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
const EVENTS_TOKEN_PARENT_KEY_NAME = "scout-events-token-parent";
const DEFAULT_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Meilisearch key action that authorises the analytics `POST /events`
 * endpoint. Meilisearch tenant tokens only carry `searchRules` and inherit
 * their permitted actions from the parent key they are signed with — a tenant
 * token cannot itself be scoped to events. So the events capability has to
 * live on a dedicated parent key.
 *
 * `KeyCreation.actions` is typed as `string[]` in the SDK (no enum), so this
 * constant is the single place the action name is asserted. Confirm against
 * the running Meilisearch cluster's key-actions reference before relying on
 * event ingestion in production.
 */
// Per validation against live MeiliSearch cluster (see
// src/lib/search/meilisearch-events-action-validation.test.ts),
// the "events.add" action is rejected with invalid_api_key_actions.
// MeiliSearch docs confirm event submission works with the "search"
// action, which is what tenant tokens for search already use.
const EVENTS_KEY_ACTION = "search";

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

// ── Document operations (Stage 1) ────────────────────────────────────────────

export type TaskRef = { taskUid: number };

/**
 * Upsert a batch of documents into an instance's index. Idempotent on `id`
 * (the index's primary key). Returns the Meilisearch task UID — callers
 * persist it on `product_sync_status.last_error`-or-similar so failed tasks
 * are recoverable.
 *
 * Per docs/policy/search-foundations.md §5.
 */
export async function upsertDocuments(
  instanceId: number,
  documents: ScoutSearchDocument[]
): Promise<TaskRef> {
  if (documents.length === 0) return { taskUid: -1 };
  const client = getClient();
  try {
    const task = await client.index(indexUidFor(instanceId)).addDocuments(documents, {
      primaryKey: "id",
    });
    return { taskUid: task.taskUid };
  } catch (err) {
    throw new MeilisearchOpError(
      `upsertDocuments(${instanceId}, ${documents.length}) failed`,
      err
    );
  }
}

export async function deleteDocument(
  instanceId: number,
  documentId: number
): Promise<TaskRef> {
  const client = getClient();
  try {
    const task = await client.index(indexUidFor(instanceId)).deleteDocument(documentId);
    return { taskUid: task.taskUid };
  } catch (err) {
    if (err instanceof MeilisearchApiError && err.response.status === 404) {
      return { taskUid: -1 };
    }
    throw new MeilisearchOpError(`deleteDocument(${instanceId}, ${documentId}) failed`, err);
  }
}

export async function deleteAllDocuments(instanceId: number): Promise<TaskRef> {
  const client = getClient();
  try {
    const task = await client.index(indexUidFor(instanceId)).deleteAllDocuments();
    return { taskUid: task.taskUid };
  } catch (err) {
    throw new MeilisearchOpError(`deleteAllDocuments(${instanceId}) failed`, err);
  }
}

export async function getDocumentCount(instanceId: number): Promise<number> {
  const client = getClient();
  try {
    const stats = await client.index(indexUidFor(instanceId)).getStats();
    return stats.numberOfDocuments ?? 0;
  } catch (err) {
    if (err instanceof MeilisearchApiError && err.response.status === 404) return 0;
    throw new MeilisearchOpError(`getDocumentCount(${instanceId}) failed`, err);
  }
}

/** Result returned by `searchInstance`. The shape is intentionally narrow —
 * the search proxy combines this with the variant matcher to build the
 * public response. */
export type RawSearchResult = {
  hits: Array<ScoutSearchDocument & { _matchesPosition?: Record<string, unknown> }>;
  estimatedTotalHits: number;
  processingTimeMs: number;
  query: string;
  /**
   * Present only when Meilisearch echoes its analytics metadata back (we send
   * the `Meili-Include-Metadata: true` request header). `queryUid` is the
   * identifier the storefront must report click events against so Meilisearch
   * can attribute them to this exact query. The SDK's SearchResponse type does
   * not model this experimental field yet, so it is read defensively.
   */
  metadata?: {
    queryUid?: string;
    requestUid?: string;
    indexUid?: string;
    primaryKey?: string;
  };
};

export type SearchOptions = {
  query: string;
  limit?: number;
  offset?: number;
  filter?: string | string[];
  sort?: string[];
};

/**
 * Search an instance's index. Always requests `showMatchesPosition: true` so
 * the variant matcher can read per-field match locations.
 *
 * Per docs/policy/search-foundations.md §5 + §7.
 */
export async function searchInstance(
  instanceId: number,
  opts: SearchOptions
): Promise<RawSearchResult> {
  const client = getClient();
  const { query, limit, offset, filter, sort } = opts;
  try {
    const res = await client.index(indexUidFor(instanceId)).search(
      query,
      {
        limit: limit ?? 20,
        offset: offset ?? 0,
        filter,
        sort,
        showMatchesPosition: true,
      },
      // Opt into Meilisearch's analytics metadata so the response carries the
      // real queryUid (needed to attribute storefront click events). This is
      // an experimental Meilisearch feature surfaced via a request header.
      { headers: { "Meili-Include-Metadata": "true" } }
    );
    // The SDK's SearchResponse type does not model the experimental metadata
    // block; read it defensively under both the documented and the
    // underscore-prefixed key.
    const meta = (res as unknown as {
      metadata?: RawSearchResult["metadata"];
      _metadata?: RawSearchResult["metadata"];
    });
    return {
      hits: res.hits as RawSearchResult["hits"],
      estimatedTotalHits: res.estimatedTotalHits ?? res.hits.length,
      processingTimeMs: res.processingTimeMs ?? 0,
      query: res.query ?? query,
      metadata: meta.metadata ?? meta._metadata,
    };
  } catch (err) {
    throw new MeilisearchOpError(`searchInstance(${instanceId}) failed`, err);
  }
}

export async function getTaskStatus(taskUid: number): Promise<{
  status: string;
  error?: { code?: string; message?: string };
}> {
  const client = getClient();
  try {
    const task = await client.tasks.getTask(taskUid);
    return {
      status: task.status,
      error: task.error
        ? { code: task.error.code, message: task.error.message }
        : undefined,
    };
  } catch (err) {
    throw new MeilisearchOpError(`getTaskStatus(${taskUid}) failed`, err);
  }
}

// ── Tenant tokens ─────────────────────────────────────────────────────────────

const parentKeyCache = new Map<string, { uid: string; key: string }>();

/**
 * Find or create a named parent API key GroLabs uses to sign tenant tokens.
 * Identified by name; results cached in module scope per name.
 *
 * Tenant tokens inherit the parent's permitted actions, so each parent is
 * scoped to the minimum action set it needs — never admin-level. Cleaner
 * blast radius than minting tokens with the master key directly.
 */
async function getOrCreateParentKey(
  name: string,
  actions: string[],
  description: string
): Promise<{ uid: string; key: string }> {
  const cached = parentKeyCache.get(name);
  if (cached) return cached;
  const client = getClient();
  try {
    const { results } = await client.getKeys({ limit: 100 });
    const existing = results.find((k) => k.name === name);
    if (existing) {
      const entry = { uid: existing.uid, key: existing.key };
      parentKeyCache.set(name, entry);
      return entry;
    }
    const created = await client.createKey({
      name,
      description,
      actions,
      indexes: ["*"],
      expiresAt: null,
    });
    const entry = { uid: created.uid, key: created.key };
    parentKeyCache.set(name, entry);
    return entry;
  } catch (err) {
    throw new MeilisearchOpError(`getOrCreateParentKey(${name}) failed`, err);
  }
}

/**
 * The search-scoped parent key (`actions: ['search']`). Backwards-compatible
 * wrapper retained so existing callers do not change.
 */
async function getOrCreateParentSearchKey(): Promise<{ uid: string; key: string }> {
  return getOrCreateParentKey(
    TENANT_TOKEN_PARENT_KEY_NAME,
    ["search"],
    "Parent key for GroLabs tenant tokens. Search-only."
  );
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

/**
 * Mint a short-lived token the storefront uses to submit analytics events
 * (currently: search-result clicks) for one instance's index.
 *
 * Signed with the events-scoped parent key (`actions: [search]`) because
 * Meilisearch tenant tokens inherit actions from their parent — `searchRules`
 * alone cannot authorise the `/events` endpoint. The same per-index
 * `instance_id = N` search rule is still applied as a defense-in-depth
 * tenant boundary. Default TTL 15 minutes, same as search tokens.
 */
export async function generateInstanceEventsToken(
  instanceId: number,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): Promise<{ token: string; expiresAt: number; indexUid: string }> {
  const parent = await getOrCreateParentKey(
    EVENTS_TOKEN_PARENT_KEY_NAME,
    [EVENTS_KEY_ACTION],
    "Parent key for GroLabs storefront event-submission tokens."
  );
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
    throw new MeilisearchOpError(`generateInstanceEventsToken(${instanceId}) failed`, err);
  }
}

// ── Test seam ─────────────────────────────────────────────────────────────────

/**
 * Reset module-scoped caches. For tests and for the admin "reload connection"
 * action — picks up env-var changes without a process restart.
 */
export function _resetClientCache(): void {
  cached = null;
  parentKeyCache.clear();
}
