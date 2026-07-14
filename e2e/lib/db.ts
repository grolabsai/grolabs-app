import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * DB-assert side of the E2E tier: every journey spec drives the browser and
 * then proves the rows landed here, via the service-role client (the tests
 * run outside any user session, same trust model as the ingest routes).
 */

/** Instance 12 = the GroLabs.io test storefront (docs/state/instances.md). */
export const TEST_INSTANCE_ID = 12;

/**
 * Instance-id trap (CLAUDE.md §2): instance 0 is a real, queryable value and
 * falsy in JS. Every place an instance id flows through the harness must use
 * `== null`, never truthiness. This guard is the single chokepoint.
 */
export function assertInstanceId(value: number | null | undefined): number {
  if (value == null) {
    throw new Error("instance_id is null/undefined — refusing to build a query without one");
  }
  return value;
}

let client: SupabaseClient | null = null;

/** Service-role Supabase client for row asserts. Requires .env.local. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — the E2E tier needs .env.local for its DB asserts",
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/**
 * Poll until `fetchRow` returns a non-null row or the timeout elapses.
 * Storefront events reach the DB asynchronously (keepalive POSTs, best-effort
 * logging), so a one-shot SELECT right after a click is a race.
 */
export async function waitForRow<T>(
  fetchRow: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 1_000, label = "row" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const row = await fetchRow();
      if (row != null) return row;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}` +
      (lastError ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})` : ""),
  );
}

export type QueryLogRow = {
  id: number;
  instance_id: number;
  query: string;
  total_hits: number;
  query_uid: string | null;
  user_id: string | null;
  is_committed: boolean | null;
  commit_reason: string | null;
  origin: string | null;
  status: number | null;
  created_at: string;
};

export type AnalyticsEventRow = {
  id: number;
  instance_id: number;
  event_type: string;
  event_name: string | null;
  user_id: string | null;
  query_uid: string | null;
  object_id: string | null;
  object_name: string | null;
  position: number | null;
  cart_id: string | null;
  order_id: string | null;
  created_at: string;
};

/** Latest query_log row on the test instance matching `query`, since `sinceIso`. */
export async function latestQueryLog(
  query: string,
  sinceIso: string,
  extra: Partial<Pick<QueryLogRow, "is_committed">> = {},
): Promise<QueryLogRow | null> {
  let q = db()
    .from("query_log")
    .select("*")
    .eq("instance_id", assertInstanceId(TEST_INSTANCE_ID))
    .eq("query", query)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (extra.is_committed != null) q = q.eq("is_committed", extra.is_committed);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`query_log select failed: ${error.message}`);
  return (data as QueryLogRow | null) ?? null;
}

/** Latest analytics_event row of `eventType` on the test instance since `sinceIso`. */
export async function latestEvent(
  eventType: string,
  sinceIso: string,
  extra: Partial<Pick<AnalyticsEventRow, "object_id" | "user_id">> = {},
): Promise<AnalyticsEventRow | null> {
  let q = db()
    .from("analytics_event")
    .select("*")
    .eq("instance_id", assertInstanceId(TEST_INSTANCE_ID))
    .eq("event_type", eventType)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (extra.object_id != null) q = q.eq("object_id", extra.object_id);
  if (extra.user_id != null) q = q.eq("user_id", extra.user_id);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`analytics_event select failed: ${error.message}`);
  return (data as AnalyticsEventRow | null) ?? null;
}
