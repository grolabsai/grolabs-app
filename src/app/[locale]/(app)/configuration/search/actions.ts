"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ping,
  ensureIndex,
  getDocumentCount,
  searchInstance,
} from "@/lib/search/meilisearch-client";
import { indexAllForInstance } from "@/lib/search/indexer";
import {
  FACET_ALLOWLIST,
  buildMeilisearchFilter,
  sanitizeFacets,
  type FacetFilter,
} from "@/lib/search/facets";

/**
 * Server actions for /configuration/search (Stage 0 admin panel).
 *
 * Per docs/policy/search-foundations.md §8. Three actions:
 *   - testMeilisearchConnection: live health probe via the master key
 *   - saveStorefrontDomains:     normalize + persist instance.storefront_domains
 *   - initializeIndex:           idempotent createIndex + applyDefaultSettings
 */

export type ConnectionTestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

export async function testMeilisearchConnection(): Promise<ConnectionTestResult> {
  return ping();
}

export type SaveDomainsResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: "unauthorized" | "invalid_input" | "save_failed"; message?: string };

/**
 * Bare-hostname normalization. Strips scheme, port, path. Lowercases.
 * Drops empty entries and dedupes. Rejects entries that don't look like a host.
 */
function normalizeDomains(input: string[]): string[] | null {
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let host: string;
    try {
      // URL needs a scheme; tack one on if the user pasted a bare domain.
      const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      host = url.hostname;
    } catch {
      return null;
    }
    // Cheap sanity check — must contain at least one dot OR be localhost.
    if (host !== "localhost" && !host.includes(".")) return null;
    seen.add(host.toLowerCase());
  }
  return Array.from(seen).sort();
}

export async function saveStorefrontDomains(
  instanceId: number,
  rawDomains: string[]
): Promise<SaveDomainsResult> {
  const sb = await createClient();

  // Auth check — must be a member of the instance they're editing.
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  const normalized = normalizeDomains(rawDomains);
  if (normalized === null) return { ok: false, error: "invalid_input" };

  const { error } = await sb
    .from("instance")
    .update({ storefront_domains: normalized })
    .eq("instance_id", instanceId);
  if (error) return { ok: false, error: "save_failed", message: error.message };

  revalidatePath("/configuration/search");
  return { ok: true, domains: normalized };
}

export type InitIndexResult =
  | { ok: true; indexUid: string }
  | { ok: false; error: string };

export async function initializeIndex(instanceId: number): Promise<InitIndexResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  try {
    const indexUid = await ensureIndex(instanceId);
    return { ok: true, indexUid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

// ── Stage 1: indexing status + reindex ────────────────────────────────────

export type IndexingStatus = {
  meiliDocCount: number;
  rreProductCount: number;
  lastSearchSyncAt: string | null;
  failedCount: number;
  pendingCount: number;
  /** True when the Meili count and GroLabs count agree. */
  inSync: boolean;
};

async function authorizeMembership(instanceId: number): Promise<boolean> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  return !!membership;
}

export async function getIndexingStatus(instanceId: number): Promise<IndexingStatus | null> {
  if (!(await authorizeMembership(instanceId))) return null;

  // Service-role for counts: we want exact totals regardless of RLS.
  const sb = createServiceRoleClient();

  const [meiliCount, rreCount, instanceRow, failedCount, pendingCount] = await Promise.all([
    getDocumentCount(instanceId).catch(() => 0),
    sb
      .from("product")
      .select("product_id", { count: "exact", head: true })
      .eq("instance_id", instanceId)
      .eq("is_active", true),
    sb
      .from("instance")
      .select("last_search_sync_at")
      .eq("instance_id", instanceId)
      .maybeSingle(),
    sb
      .from("failed_indexing")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instanceId),
    sb
      .from("product_sync_status")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instanceId)
      .eq("platform", "meilisearch")
      .eq("last_status", "error"),
  ]);

  const rreProductCount = rreCount.count ?? 0;
  const meiliDocCount = meiliCount;
  const lastSearchSyncAt = (instanceRow.data?.last_search_sync_at as string | null) ?? null;

  return {
    meiliDocCount,
    rreProductCount,
    lastSearchSyncAt,
    failedCount: failedCount.count ?? 0,
    pendingCount: pendingCount.count ?? 0,
    inSync: meiliDocCount === rreProductCount,
  };
}

// ── Stage 1: in-app search preview ────────────────────────────────────────
//
// Powers the "Search preview" panel on the config screen so operators can dry-
// run queries against their own index without spinning up the storefront. This
// is the dashboard equivalent of the public /api/v1/search proxy — same index,
// same filter pinning, but authenticated via instance_member instead of an
// authorized storefront origin (so rate-limiting and the query_log write are
// intentionally skipped — this surface is staff-only).

/**
 * One query token's matching status against a single hit. Drives the
 * green/red pills in the preview pane: `attributes` empty → red (Meilisearch
 * returned the hit for some other reason, e.g. typo tolerance or a synonym,
 * but this exact token never appears in any searchable field of this hit);
 * non-empty → green, and we surface which attribute(s) carried the match so
 * the operator can verify intent ("red matched on `name`, not on a colour
 * attribute — that's why this product is here").
 */
export type SearchPreviewTokenMatch = {
  /** The token as the user typed it, lowercased for display. */
  token: string;
  /** Attribute paths (e.g. "name", "brand", "variants.attributes") that
   * contained a highlight covering this token. Empty when unmatched. */
  attributes: string[];
};

export type SearchPreviewHit = {
  id: number;
  name: string;
  brand: string | null;
  price: number | null;
  salePrice: number | null;
  currency: string;
  inStock: boolean;
  sku: string | null;
  imageUrl: string | null;
  categories: string[];
  /** Per-query-token match data — one entry per token in the query, in
   * order. Undefined when the query was empty. */
  tokenMatches: SearchPreviewTokenMatch[];
};

export type SearchPreviewResult =
  | {
      ok: true;
      query: string;
      hits: SearchPreviewHit[];
      totalHits: number;
      processingTimeMs: number;
    }
  | { ok: false; error: "unauthorized" | "search_failed"; message?: string };

/** Split the raw query into tokens the same way an end-user would read them
 * back. Whitespace boundaries, lowercased, deduped while preserving order. */
function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of query.toLowerCase().split(/\s+/g)) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Walk a Meilisearch `_formatted` block and yield every `<em>…</em>`
 * highlight as `{ attributePath, highlightedText }` pairs. Top-level keys
 * are searchable attribute names; nested values are descended recursively
 * so `variants[].attributes.color` etc. surface under a stable dotted path.
 *
 * Highlights are matched with a non-greedy regex against the rendered
 * string. We don't need to handle nested `<em>` because Meilisearch never
 * produces them.
 */
function collectHighlights(
  formatted: Record<string, unknown> | undefined,
): Array<{ attribute: string; text: string }> {
  if (!formatted) return [];
  const out: Array<{ attribute: string; text: string }> = [];
  const re = /<em>([\s\S]*?)<\/em>/g;

  const visit = (value: unknown, path: string) => {
    if (value == null) return;
    if (typeof value === "string") {
      for (const m of value.matchAll(re)) {
        const text = m[1];
        if (text) out.push({ attribute: path, text: text.toLowerCase() });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, path);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };

  for (const [k, v] of Object.entries(formatted)) {
    visit(v, k);
  }
  return out;
}

/** Build per-token match data for a single hit by cross-referencing the
 * query tokens against highlights extracted from `_formatted`. A token is
 * "matched" by an attribute when any highlight under that attribute starts
 * with the token (Meilisearch highlights the full token plus any prefix-
 * tolerance suffix it accepted, so prefix-match is the right relationship).
 *
 * Returned attributes are deduped and ordered by first-seen position so
 * pills render consistently across re-renders. */
function buildTokenMatches(
  tokens: string[],
  highlights: Array<{ attribute: string; text: string }>,
): SearchPreviewTokenMatch[] {
  return tokens.map((token) => {
    const attrs: string[] = [];
    const seen = new Set<string>();
    for (const h of highlights) {
      // Prefix match catches Meilisearch's typo + prefix tolerance — a query
      // for "sweat" highlights "sweater", and we still want to credit
      // `name` as the matching attribute.
      if (!h.text.startsWith(token) && !token.startsWith(h.text)) continue;
      if (seen.has(h.attribute)) continue;
      seen.add(h.attribute);
      attrs.push(h.attribute);
    }
    return { token, attributes: attrs };
  });
}

export async function previewSearch(
  instanceId: number,
  query: string,
): Promise<SearchPreviewResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  try {
    const raw = await searchInstance(instanceId, {
      query,
      limit: 12,
      // Defense in depth: same instance_id pin as the public proxy. A bug in
      // index routing or a stale shared index can never spill cross-instance.
      filter: `instance_id = ${instanceId}`,
      // Drives the per-token match pills in the preview UI.
      highlight: true,
    });

    const tokens = tokenizeQuery(query);

    const hits: SearchPreviewHit[] = raw.hits.map((h) => {
      const highlights = collectHighlights(h._formatted);
      return {
        id: h.id,
        name: h.name,
        brand: h.brand ?? null,
        price: h.price ?? null,
        salePrice: h.sale_price ?? null,
        currency: h.currency ?? "",
        inStock: !!h.in_stock,
        sku: h.sku ?? null,
        imageUrl: h.thumbnail_url ?? h.image_url ?? null,
        categories: Array.isArray(h.categories) ? h.categories.slice(0, 2) : [],
        tokenMatches: buildTokenMatches(tokens, highlights),
      };
    });

    return {
      ok: true,
      query,
      hits,
      totalHits: raw.estimatedTotalHits,
      processingTimeMs: raw.processingTimeMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: "search_failed",
      message: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ── Request log diagnostics ───────────────────────────────────────────────
//
// Tails query_log for the request-log panel on /configuration/search. Each
// row represents one inbound /api/v1/search call (successes AND known-instance
// denials, per the route handler). The panel polls this on a short interval
// so operators can watch WP plugin traffic land in real time without leaving
// GroLabs.

export type SearchRequestLogHit = {
  wcId: number | null;
  name: string | null;
  variationId: number | null;
};

export type SearchRequestLogRow = {
  id: number;
  createdAt: string;
  query: string;
  origin: string | null;
  status: number;
  denialReason: string | null;
  totalHits: number | null;
  processingTimeMs: number | null;
  totalHandlerMs: number | null;
  hits: SearchRequestLogHit[];
};

export type RecentSearchRequestsResult =
  | { ok: true; rows: SearchRequestLogRow[] }
  | { ok: false; error: "unauthorized" };

/**
 * Most-recent N rows from query_log scoped to the caller's instance. RLS
 * already restricts SELECTs by instance_member, but we also gate on
 * authorizeMembership so unauthenticated requests get a clean error shape
 * rather than an empty list.
 */
export async function recentSearchRequests(
  instanceId: number,
  limit = 50,
): Promise<RecentSearchRequestsResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  const sb = await createClient();
  const { data } = await sb
    .from("query_log")
    .select("id, created_at, query, origin, status, denial_reason, total_hits, processing_time_ms, total_handler_ms, variant_selection")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  const rows: SearchRequestLogRow[] = (data ?? []).map((r) => {
    const rawSummary = r.variant_selection;
    const hits: SearchRequestLogHit[] = Array.isArray(rawSummary)
      ? rawSummary.map((h) => {
          const o = (h ?? {}) as Record<string, unknown>;
          return {
            wcId: typeof o.wc_id === "number" ? o.wc_id : null,
            name: typeof o.name === "string" ? o.name : null,
            variationId: typeof o.variation_id === "number" ? o.variation_id : null,
          };
        })
      : [];
    return {
      id: r.id as number,
      createdAt: r.created_at as string,
      query: (r.query as string) ?? "",
      origin: (r.origin as string | null) ?? null,
      status: (r.status as number) ?? 200,
      denialReason: (r.denial_reason as string | null) ?? null,
      // Successful rows from before the diagnostics columns existed still have
      // default 0 here, but they're not denials — surface them as-is.
      totalHits: r.total_hits == null ? null : (r.total_hits as number),
      processingTimeMs: r.processing_time_ms == null ? null : (r.processing_time_ms as number),
      totalHandlerMs: r.total_handler_ms == null ? null : (r.total_handler_ms as number),
      hits,
    };
  });

  return { ok: true, rows };
}

// ── Event analytics ───────────────────────────────────────────────────────
//
// Backs the "Eventos recientes" panel on /configuration/search. Reads from
// analytics_event, populated by /api/v1/events as the WP plugin emits
// click + conversion events from the storefront. See
// docs/policy/search-events.md for the upstream flow.
//
// Both queries are scoped to the caller's instance via RLS plus an
// explicit authorizeMembership() gate so an unauthenticated request gets
// a clean error rather than an empty list. Mirrors recentSearchRequests.

export type SearchEventRow = {
  id: number;
  createdAt: string;
  eventType: string;
  eventName: string;
  queryUid: string | null;
  indexUid: string | null;
  objectId: string | null;
  objectName: string | null;
  position: number | null;
  origin: string | null;
};

export type RecentSearchEventsResult =
  | { ok: true; rows: SearchEventRow[] }
  | { ok: false; error: "unauthorized" };

export async function recentSearchEvents(
  instanceId: number,
  limit = 50,
): Promise<RecentSearchEventsResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  const sb = await createClient();
  const { data } = await sb
    .from("analytics_event")
    .select("id, created_at, event_type, event_name, query_uid, index_uid, object_id, object_name, position, origin")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  const rows: SearchEventRow[] = (data ?? []).map((r) => ({
    id: r.id as number,
    createdAt: r.created_at as string,
    eventType: (r.event_type as string) ?? "",
    eventName: (r.event_name as string) ?? "",
    queryUid: (r.query_uid as string | null) ?? null,
    indexUid: (r.index_uid as string | null) ?? null,
    objectId: (r.object_id as string | null) ?? null,
    objectName: (r.object_name as string | null) ?? null,
    position: r.position == null ? null : (r.position as number),
    origin: (r.origin as string | null) ?? null,
  }));

  return { ok: true, rows };
}

/**
 * Per-event-name counts for the trailing 24h. Drives the chip row above
 * the events table — operators see at a glance whether each event type
 * is firing or not. The five known event names are pre-seeded so a name
 * that's never fired returns 0 rather than going missing entirely.
 */
export type SearchEventCounts = {
  windowSeconds: number;
  byName: Record<string, number>;
};

export type SearchEventCountsResult =
  | { ok: true; counts: SearchEventCounts }
  | { ok: false; error: "unauthorized" };

const KNOWN_EVENT_NAMES = [
  "Search Result Clicked",
  "Added to cart from PLP",
  "Added to cart from PDP",
  "Proceeded to check out",
  "Completed order",
] as const;

export async function searchEventCounts(
  instanceId: number,
  windowSeconds = 24 * 60 * 60,
): Promise<SearchEventCountsResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  const sb = await createClient();
  const sinceIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
  // Fetching ALL events in the window with just the event_name column is
  // cheap (small payload, indexed by instance_id+created_at). Aggregating
  // client-side avoids needing a Postgres RPC.
  const { data } = await sb
    .from("analytics_event")
    .select("event_name")
    .gte("created_at", sinceIso);

  const byName: Record<string, number> = {};
  // Seed known names at 0 so the chip row always shows the full taxonomy.
  for (const name of KNOWN_EVENT_NAMES) byName[name] = 0;
  for (const row of data ?? []) {
    const name = (row.event_name as string) ?? "";
    if (!name) continue;
    byName[name] = (byName[name] ?? 0) + 1;
  }

  return { ok: true, counts: { windowSeconds, byName } };
}

// ── Stage 1: in-RRE search emulator ─────────────────────────────────────
//
// Per docs/policy/search-foundations.md §17. Powers the "Emulador" tab on
// /configuration/search. Goes through the same Meilisearch path the public
// /api/v1/search proxy uses (same client, same filter pinning), but the
// auth boundary is instance_member, not storefront-origin allowlist — this
// is a staff-only surface, so rate-limiting + query_log writes are skipped.

/** One per-attribute match in an emulator result card. The attribute path
 * came from Meilisearch's `_formatted` block (so e.g. `name`,
 * `variants.attributes.pa_size`, `scout_attributes.lifestage`). The tokens
 * are everything Meilisearch highlighted under that path, deduped and
 * lowercased — what the user actually typed-or-something-tolerant-of-it. */
export type EmulatorAttributeMatch = {
  attribute: string;
  tokens: string[];
};

export type EmulatorHit = {
  id: number;
  name: string;
  brand: string | null;
  price: number | null;
  salePrice: number | null;
  currency: string;
  inStock: boolean;
  sku: string | null;
  imageUrl: string | null;
  categories: string[];
  /** One entry per searchable attribute that contributed to this hit. Empty
   * when the query was empty (no highlights to surface). Ordered by first
   * appearance for stable rendering across re-renders. */
  attributeMatches: EmulatorAttributeMatch[];
};

export type EmulatorFacets = {
  /** Per-facet value → count distribution. Restrictive (respects active
   * filters) — see policy §7 facets amendment. */
  distribution: Record<string, Record<string, number>>;
  /** Numeric facet stats. Today only `price` is numeric in the allowlist. */
  stats: Record<string, { min: number; max: number }>;
};

export type EmulatorSearchInput = {
  query: string;
  /** Single category constraint from the dropdown above the search input.
   * MUST be the WooCommerce term ID (matches indexed `category_ids[]` per
   * §4), not RRE's `category.category_id`. `null` clears the constraint. */
  categoryWcId: number | null;
  /** Facet rail selections — converted to a Meilisearch filter expression
   * server-side via `buildMeilisearchFilter`. */
  filters: FacetFilter[];
  /** Names of facets to compute distributions for. Server gates against
   * `FACET_ALLOWLIST`. */
  facets: string[];
};

export type EmulatorSearchResult =
  | {
      ok: true;
      query: string;
      hits: EmulatorHit[];
      totalHits: number;
      processingTimeMs: number;
      facets: EmulatorFacets;
    }
  | { ok: false; error: "unauthorized" | "search_failed"; message?: string };

/** Cap on the number of values returned per facet. Mirrors the
 * `maxValuesPerFacet: 100` index setting so the UI's "show top N" stays
 * meaningful without surprising the client with a 100-item dropdown. */
const EMULATOR_FACET_VALUE_CAP = 50;

/** Walk a Meilisearch `_formatted` block and collect `{ attribute, text }`
 * pairs for every `<em>…</em>` highlight. Mirrors the helper used by
 * `_search-preview.tsx`. */
function collectHighlightsForEmulator(
  formatted: Record<string, unknown> | undefined,
): Array<{ attribute: string; text: string }> {
  if (!formatted) return [];
  const out: Array<{ attribute: string; text: string }> = [];
  const re = /<em>([\s\S]*?)<\/em>/g;
  const visit = (value: unknown, path: string) => {
    if (value == null) return;
    if (typeof value === "string") {
      for (const m of value.matchAll(re)) {
        const text = m[1];
        if (text) out.push({ attribute: path, text: text.toLowerCase() });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, path);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };
  for (const [k, v] of Object.entries(formatted)) visit(v, k);
  return out;
}

/** Group highlights by attribute path, preserving first-seen attribute order
 * and dedup'ing tokens within each attribute. This is what each result card
 * renders — "name → royal, canin" / "description → puppy". */
function groupHighlightsByAttribute(
  highlights: Array<{ attribute: string; text: string }>,
): EmulatorAttributeMatch[] {
  const byAttr = new Map<string, string[]>();
  for (const h of highlights) {
    const existing = byAttr.get(h.attribute);
    if (existing) {
      if (!existing.includes(h.text)) existing.push(h.text);
    } else {
      byAttr.set(h.attribute, [h.text]);
    }
  }
  return Array.from(byAttr, ([attribute, tokens]) => ({ attribute, tokens }));
}

/** Trim a facet distribution to the top-N values per facet (by count).
 * Stops the UI from inheriting a 100-value dropdown for a high-cardinality
 * facet just because Meilisearch is willing to return it. */
function capDistribution(
  dist: Record<string, Record<string, number>> | undefined,
): Record<string, Record<string, number>> {
  if (!dist) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [facetName, values] of Object.entries(dist)) {
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);
    const capped = sorted.slice(0, EMULATOR_FACET_VALUE_CAP);
    out[facetName] = Object.fromEntries(capped);
  }
  return out;
}

export async function runEmulatorSearch(
  instanceId: number,
  input: EmulatorSearchInput,
): Promise<EmulatorSearchResult> {
  if (!(await authorizeMembership(instanceId))) {
    return { ok: false, error: "unauthorized" };
  }

  // Build the filter: facet selections → AND clauses, plus the category
  // dropdown's single category_id constraint (if any), plus the instance_id
  // pin as defense-in-depth (same pattern the public proxy uses).
  const filters: FacetFilter[] = [...input.filters];
  if (typeof input.categoryWcId === "number" && Number.isFinite(input.categoryWcId)) {
    filters.push({
      kind: "in_numeric",
      attribute: "category_ids",
      values: [input.categoryWcId],
    });
  }
  const facetFilter = buildMeilisearchFilter(filters);
  const instancePin = `instance_id = ${instanceId}`;
  const finalFilter = facetFilter ? `(${facetFilter}) AND ${instancePin}` : instancePin;

  const wantedFacets = sanitizeFacets(input.facets);

  try {
    const raw = await searchInstance(instanceId, {
      query: input.query,
      limit: 24,
      filter: finalFilter,
      highlight: true,
      facets: wantedFacets.length > 0 ? wantedFacets : undefined,
    });

    const hits: EmulatorHit[] = raw.hits.map((h) => {
      const highlights = collectHighlightsForEmulator(h._formatted);
      return {
        id: h.id,
        name: h.name,
        brand: h.brand ?? null,
        price: h.price ?? null,
        salePrice: h.sale_price ?? null,
        currency: h.currency ?? "",
        inStock: !!h.in_stock,
        sku: h.sku ?? null,
        imageUrl: h.thumbnail_url ?? h.image_url ?? null,
        categories: Array.isArray(h.categories) ? h.categories.slice(0, 3) : [],
        attributeMatches: groupHighlightsByAttribute(highlights),
      };
    });

    return {
      ok: true,
      query: input.query,
      hits,
      totalHits: raw.estimatedTotalHits,
      processingTimeMs: raw.processingTimeMs,
      facets: {
        distribution: capDistribution(raw.facetDistribution),
        stats: raw.facetStats ?? {},
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: "search_failed",
      message: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ── Category list for the emulator dropdown ───────────────────────────────

export type EmulatorCategory = {
  /** RRE's internal PK — stable id for the React option. */
  categoryId: number;
  /** WooCommerce term ID. This is what gets matched against the indexed
   * document's `category_ids[]` (per §4: indexed value is WC IDs, not RRE
   * PKs). Categories without a WC mapping are excluded from the dropdown —
   * they cannot be used as a Meilisearch filter. */
  woocommerceId: number;
  /** Display label with ancestor breadcrumb (`Root › Sub › Leaf`) for
   * disambiguation when names repeat across branches of the tree. */
  label: string;
};

/** Active categories for the current instance, flattened with breadcrumb
 * labels and intersected with the WC mapping so every entry is filterable
 * against Meilisearch. RLS scopes by instance_member; we still gate so the
 * unauthorized shape is consistent with the other emulator actions. */
export async function listEmulatorCategories(
  instanceId: number,
): Promise<EmulatorCategory[]> {
  if (!(await authorizeMembership(instanceId))) return [];

  const sb = await createClient();
  const { data } = await sb
    .from("category")
    .select("category_id, parent_category_id, category_name, woocommerce_id")
    .eq("is_active", true);

  type Row = {
    category_id: number;
    parent_category_id: number | null;
    category_name: string;
    woocommerce_id: number | null;
  };
  const rows: Row[] = (data ?? []) as Row[];
  const byId = new Map(rows.map((r) => [r.category_id, r]));

  const labelFor = (row: Row): string => {
    const segments: string[] = [];
    let cur: Row | undefined = row;
    const seen = new Set<number>();
    while (cur) {
      if (seen.has(cur.category_id)) break; // cycle guard, shouldn't happen
      seen.add(cur.category_id);
      segments.unshift(cur.category_name);
      cur =
        cur.parent_category_id != null ? byId.get(cur.parent_category_id) : undefined;
    }
    return segments.join(" › ");
  };

  return rows
    .filter((r): r is Row & { woocommerce_id: number } => typeof r.woocommerce_id === "number")
    .map((r) => ({
      categoryId: r.category_id,
      woocommerceId: r.woocommerce_id,
      label: labelFor(r),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The allowlist re-exported as a server-action-friendly accessor so the
 * client emulator doesn't have to import the lib directly (keeps the
 * emulator client component free of server-only imports). */
export async function getEmulatorFacetAllowlist(): Promise<string[]> {
  return [...FACET_ALLOWLIST];
}

// ── Dynamic per-attribute facet list ──────────────────────────────────────
//
// Drives the dynamic middle section of the emulator facet rail. When a
// category is selected, attributes are scoped + ordered by
// `category_product_attribute.form_order` (the merchant's own priority
// ranking per the catalog editor). When no category is selected, the full
// instance-wide filterable list is returned ordered by attribute_name —
// there's no global priority value yet.

export type EmulatorAttributeFacet = {
  attributeId: number;
  attributeCode: string;
  attributeName: string;
  /** Meilisearch facet path corresponding to this attribute. Always
   * `attributes.<code>` — kept on the wire so the client doesn't have to
   * compose it (and so we have a single spot to add a different prefix
   * later if needed). */
  facetName: string;
};

/**
 * Resolve the localized display name for a set of attributes. Returns a
 * Map<attribute_id, attribute_name> populated only for attributes that have
 * a translation row for the given locale. Callers fall through to the
 * canonical `product_attribute.attribute_name` when an attribute is missing.
 *
 * Per CLAUDE.md §5: data labels come from the DB. Per-locale display names
 * live in `product_attribute_translation`; the canonical `attribute_name`
 * column on `product_attribute` is the fallback when no translation exists.
 */
async function resolveAttributeLabels(
  attributeIds: number[],
  locale: string,
): Promise<Map<number, string>> {
  if (attributeIds.length === 0) return new Map();
  const sb = await createClient();
  const { data } = await sb
    .from("product_attribute_translation")
    .select("attribute_id, attribute_name")
    .in("attribute_id", attributeIds)
    .eq("locale", locale);
  const out = new Map<number, string>();
  for (const r of data ?? []) {
    const id = r.attribute_id as number;
    const name = (r.attribute_name as string | null) ?? null;
    // NULL translation rows count as "no translation" — the canonical
    // attribute_name on product_attribute wins.
    if (id != null && name && name.trim().length > 0) out.set(id, name);
  }
  return out;
}

/** Filterable, list-type attributes for an instance — optionally narrowed
 * to those mapped to a specific category and ordered by that mapping's
 * `form_order`. The "list-type only" filter mirrors the document builder's
 * v1 scope (only list attributes are currently indexed in `attributes.*`).
 *
 * Labels are resolved against `product_attribute_translation` for the
 * active locale (resolved from the request via next-intl), with fallback
 * to the canonical `product_attribute.attribute_name`. */
export async function listEmulatorAttributeFacets(
  instanceId: number,
  categoryId: number | null,
): Promise<EmulatorAttributeFacet[]> {
  if (!(await authorizeMembership(instanceId))) return [];

  const sb = await createClient();
  const locale = await getLocale();

  if (categoryId != null) {
    // Category-scoped: only attributes mapped to this category, in the
    // merchant's own form_order. `visible_in_filter` flips a mapping to
    // hidden in the facet rail without dropping it from the catalog.
    const { data } = await sb
      .from("category_product_attribute")
      .select(
        `form_order, visible_in_filter,
         product_attribute:product_attribute!inner (
           attribute_id, attribute_code, attribute_name, data_type,
           is_filterable, is_active
         )`,
      )
      .eq("instance_id", instanceId)
      .eq("category_id", categoryId);

    // Supabase types the FK-joined column as an array even for a single-row
    // relation, so we normalize down to the first row per mapping. The
    // mapping_id → attribute_id relation is many-to-one in our schema, so
    // there's always at most one row.
    type Joined = {
      attribute_id: number;
      attribute_code: string;
      attribute_name: string;
      data_type: string | null;
      is_filterable: boolean | null;
      is_active: boolean | null;
    };
    type RawRow = {
      form_order: number | null;
      visible_in_filter: boolean | null;
      product_attribute: Joined | Joined[] | null;
    };
    const rows = (data ?? []) as unknown as RawRow[];
    const normalized = rows.map((r) => ({
      form_order: r.form_order,
      visible_in_filter: r.visible_in_filter,
      product_attribute: Array.isArray(r.product_attribute)
        ? r.product_attribute[0] ?? null
        : r.product_attribute,
    }));

    const filtered = normalized.filter(
      (r): r is typeof r & { product_attribute: Joined } =>
        !!r.product_attribute &&
        r.product_attribute.is_active !== false &&
        !!r.product_attribute.is_filterable &&
        r.product_attribute.data_type === "list" &&
        r.visible_in_filter !== false,
    );
    const labels = await resolveAttributeLabels(
      filtered.map((r) => r.product_attribute.attribute_id),
      locale,
    );
    // Sort uses the *resolved* label (translated when present) so the
    // alphabetical tie-break reads naturally in the current locale.
    return filtered
      .sort((a, b) => {
        const ao = a.form_order ?? Number.POSITIVE_INFINITY;
        const bo = b.form_order ?? Number.POSITIVE_INFINITY;
        if (ao !== bo) return ao - bo;
        const aLabel =
          labels.get(a.product_attribute.attribute_id) ?? a.product_attribute.attribute_name;
        const bLabel =
          labels.get(b.product_attribute.attribute_id) ?? b.product_attribute.attribute_name;
        return aLabel.localeCompare(bLabel);
      })
      .map((r) => ({
        attributeId: r.product_attribute.attribute_id,
        attributeCode: r.product_attribute.attribute_code,
        attributeName:
          labels.get(r.product_attribute.attribute_id) ?? r.product_attribute.attribute_name,
        facetName: `attributes.${r.product_attribute.attribute_code}`,
      }));
  }

  // No category — every active, filterable, list-type attribute for this
  // instance, alphabetical (on the resolved label). No global priority
  // value exists today; when one lands it should slot in ahead of the name.
  const { data } = await sb
    .from("product_attribute")
    .select("attribute_id, attribute_code, attribute_name, data_type, is_filterable, is_active")
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .eq("is_filterable", true);

  const listRows = (data ?? []).filter(
    (r) => (r.data_type as string | null) === "list",
  );
  const labels = await resolveAttributeLabels(
    listRows.map((r) => r.attribute_id as number),
    locale,
  );
  return listRows
    .map((r) => {
      const attributeId = r.attribute_id as number;
      const attributeName =
        labels.get(attributeId) ?? (r.attribute_name as string);
      return {
        attributeId,
        attributeCode: r.attribute_code as string,
        attributeName,
        facetName: `attributes.${r.attribute_code as string}`,
      };
    })
    .sort((a, b) => a.attributeName.localeCompare(b.attributeName));
}

export type RunBackfillResult =
  | { ok: true; indexed: number; failed: number }
  | { ok: false; error: string };

export async function runFullBackfill(instanceId: number): Promise<RunBackfillResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: membership } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return { ok: false, error: "unauthorized" };

  try {
    const result = await indexAllForInstance(instanceId, user.id);
    revalidatePath("/configuration/search");
    if (!result.ok) return { ok: false, error: result.error ?? "backfill failed" };
    return { ok: true, indexed: result.indexed, failed: result.failed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
