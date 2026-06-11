"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
  /** Record count in the index — set by the search probe on success. */
  count?: number;
};

/**
 * Test the ADMIN/WRITE path by hitting the /1/keys endpoint. This validates
 * the Write (Admin) API key — search keys do not have access here.
 * Pure HTTP probe — no DB side-effects.
 */
export async function testAlgoliaConnection(
  appId: string,
  adminKey: string
): Promise<TestResult> {
  const url = `https://${appId}-dsn.algolia.net/1/keys/${adminKey}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": adminKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 0, latencyMs: Date.now() - start, message };
  }
}

/** Algolia analytics host for a given app region (only `us` and `de` exist). */
function analyticsHost(region: string): string {
  return region === "eu" || region === "de"
    ? "analytics.de.algolia.com"
    : "analytics.us.algolia.com";
}

/**
 * Result of probing Algolia's Analytics API with a key:
 *   - hasAcl: the key carries the `analytics` ACL (no 401/403).
 *   - ok: the probe returned data.
 *   - searchCount: total searches recorded in the probe window — 0 means the
 *     ACL is fine but Algolia simply has no search traffic for this index, so
 *     the dashboard will be empty regardless of keys.
 */
export type AnalyticsProbe = {
  hasAcl: boolean;
  ok: boolean;
  searchCount?: number;
  message?: string;
};

export type SearchTestResult = TestResult & { analytics: AnalyticsProbe };

/** Probe the Analytics API (`/2/searches/count`, last 7 days) to verify the
 *  `analytics` ACL and detect whether any search traffic exists. */
async function probeAnalytics(
  appId: string,
  key: string,
  indexName: string,
  region: string
): Promise<AnalyticsProbe> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const url =
    `https://${analyticsHost(region)}/2/searches/count` +
    `?index=${encodeURIComponent(indexName)}` +
    `&startDate=${start.toISOString().slice(0, 10)}` +
    `&endDate=${end.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": key,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { hasAcl: false, ok: false };
    }
    const data = (await res.json().catch(() => null)) as
      | { count?: number; message?: string }
      | null;
    if (!res.ok) {
      return { hasAcl: true, ok: false, message: data?.message ?? `HTTP ${res.status}` };
    }
    return { hasAcl: true, ok: true, searchCount: data?.count ?? 0 };
  } catch (err) {
    return {
      hasAcl: false,
      ok: false,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Test the SEARCH/READ path with just the Search API key — the credentials the
 * storefront actually uses. Runs a zero-hit query against the primary index
 * (`POST /1/indexes/{index}/query`), then ALSO probes the Analytics API so the
 * caller can tell whether the same key can read searches/no-results (the
 * `analytics` ACL) and whether any analytics data exists at all.
 *
 * A 200 on the query means App ID + Search key + index line up. The analytics
 * probe reports the ACL status separately. Pure HTTP probe — no DB side-effects.
 */
export async function testAlgoliaSearch(
  appId: string,
  searchKey: string,
  indexName: string,
  region: string
): Promise<SearchTestResult> {
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
    indexName
  )}/query`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": searchKey,
        "Content-Type": "application/json",
      },
      // Empty query, zero hits — cheapest possible probe that still exercises
      // the read path and index existence.
      body: JSON.stringify({ query: "", hitsPerPage: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    const detail = (await res.json().catch(() => null)) as
      | { message?: string; nbHits?: number }
      | null;
    if (!res.ok) {
      // Algolia returns { message, status } on error — surface it verbatim.
      return {
        ok: false,
        status: res.status,
        latencyMs: Date.now() - start,
        message: detail?.message ?? `HTTP ${res.status}`,
        analytics: { hasAcl: false, ok: false },
      };
    }
    const analytics = await probeAnalytics(appId, searchKey, indexName, region);
    return {
      ok: true,
      status: res.status,
      latencyMs: Date.now() - start,
      count: detail?.nbHits,
      analytics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      message,
      analytics: { hasAcl: false, ok: false },
    };
  }
}

export type SavePayload = {
  instanceId: number;
  appId: string;
  region: string;
  searchApiKey: string;
  /** Present only when the user wants to set/replace the admin key. */
  adminApiKey?: string;
  primaryIndex: string;
};

export type SaveResult = {
  ok: boolean;
  verified: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
};

/**
 * Persist Algolia credentials. Saving is NEVER blocked by incomplete data:
 * the non-secret fields are always written, and the admin key is optional.
 *
 * Admin-key resolution:
 *   - adminApiKey provided  → use it (and write it to Vault).
 *   - omitted but on file   → re-use the stored Vault secret for verification.
 *   - omitted and none on file → save config only; skip verification.
 *
 * When we end up with an admin key we also test the connection and record the
 * result; without one, the save still succeeds and verification is simply
 * skipped (verified: false, no httpStatus).
 */
export async function saveAlgoliaConfig(
  payload: SavePayload
): Promise<SaveResult> {
  const supabase = await createClient();
  const { instanceId, appId, region, searchApiKey, adminApiKey, primaryIndex } =
    payload;

  // ── Resolve the admin key we'll use (may be null — that's fine) ─────────────
  let effectiveAdminKey: string | null = null;

  if (adminApiKey) {
    effectiveAdminKey = adminApiKey;
  } else {
    // No new key supplied — re-use the stored one if there is any. A missing
    // key never blocks the save; it only means we can't verify.
    const { data: storedKey } = await supabase.rpc("algolia_get_admin_key", {
      p_instance_id: instanceId,
    });
    effectiveAdminKey = (storedKey as string | null) ?? null;
  }

  // ── Persist all fields (admin key optional — RPC skips Vault when null) ──────
  const { error: saveError } = await supabase.rpc("algolia_save_credentials", {
    p_instance_id: instanceId,
    p_app_id: appId,
    p_region: region,
    p_search_key: searchApiKey,
    p_admin_key: effectiveAdminKey,
    p_index: primaryIndex,
  });
  if (saveError) {
    // A genuine DB/RLS failure — not an "incomplete data" block.
    return { ok: false, verified: false, error: saveError.message };
  }

  // ── No key → saved, verification skipped ────────────────────────────────────
  if (!effectiveAdminKey) {
    revalidatePath("/configuration/algolia");
    return { ok: true, verified: false };
  }

  // ── Test connection + record verification ───────────────────────────────────
  const testResult = await testAlgoliaConnection(appId, effectiveAdminKey);

  await supabase.rpc("algolia_record_verification", {
    p_instance_id: instanceId,
    p_http_status: testResult.status,
    p_latency_ms: testResult.latencyMs,
  });

  revalidatePath("/configuration/algolia");

  return {
    ok: true,
    verified: testResult.ok,
    httpStatus: testResult.status,
    latencyMs: testResult.latencyMs,
  };
}
