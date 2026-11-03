import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { capturePostHog } from "@/lib/analytics/posthog";
import { assignIntent, INTENT_WINDOW_MS, type RecentQuery } from "@/lib/analytics/intent";

/**
 * GET /api/v1/events/drain
 *
 * Moves `event_inbox` rows into their real homes:
 *
 *   kind = "search_performed"  →  query_log
 *   anything else              →  analytics_event
 *
 * Per docs/design/direct-meilisearch-search.md Phase 4 step 15. The storefront
 * no longer calls GroLabs to search, so a search reaches query_log only by
 * being reported afterwards (R-10). `/api/v1/events` takes the batch and
 * answers 202; this is the half that does the real work, and therefore the
 * half allowed to be slow, to retry, and to fail loudly.
 *
 * Authorization: `Authorization: Bearer ${CRON_SECRET}`, the same contract as
 * /api/v1/integrations/ga4/poll.
 *
 * Why a route rather than the pg_cron SQL function the plan sketched: the
 * drain needs `assignIntent`, which is TypeScript, and the PostHog forwarder,
 * which is an outbound API call. Porting the intent heuristic into plpgsql
 * would put a second copy of it in the codebase — and that heuristic is
 * explicitly designed to be swapped later, so the two copies would drift the
 * first time anyone improved it. The durability argument for keeping the drain
 * in the database does not apply either: if this app is down, nothing is being
 * INGESTED, so there is nothing new to drain. The inbox simply fills and is
 * drained when the app returns, which is exactly what it is for.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Rows per run. Large enough to catch up after an outage, small enough that
 *  one run stays well inside maxDuration. */
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** How many recent queries seed intent grouping for a session. Matches the
 *  search route's window so both sides group the same way. */
const INTENT_WINDOW = 10;

type InboxRow = {
  event_id: string;
  instance_id: number;
  kind: string;
  payload: Record<string, unknown>;
  origin: string | null;
  attempts: number;
  /** Shopper's event time, anchored to our clock at ingest (R-33). */
  occurred_at: string | null;
  received_at: string;
};

function str(v: unknown, max: number): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.slice(0, max);
  if (typeof v === "number") return String(v).slice(0, max);
  return null;
}

function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";

  // Two accepted secrets, deliberately.
  //
  // CRON_SECRET is the platform-wide one Vercel's own scheduler presents, and
  // it opens every cron route there is. DRAIN_CRON_SECRET opens only this one,
  // and exists because the schedule for this route lives in Postgres
  // (migration 20261102000008 -- Vercel's plan here refuses minute-granularity
  // crons), which means the caller's secret has to be stored in a database
  // table. A copy of CRON_SECRET sitting there would quietly widen the blast
  // radius of a database read to every scheduled endpoint; a scoped one widens
  // it to this endpoint, whose whole power is "move the inbox along".
  //
  // Either is sufficient on its own, so the Vercel path keeps working if the
  // schedule ever moves back.
  const accepted = [process.env.CRON_SECRET, process.env.DRAIN_CRON_SECRET]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (!accepted.includes(auth)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const limitParam = int(req.nextUrl.searchParams.get("limit"));
  const limit = Math.min(Math.max(limitParam ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const sb = createServiceRoleClient();

  const { data, error } = await sb
    .from("event_inbox")
    .select("event_id, instance_id, kind, payload, origin, attempts, occurred_at, received_at")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[drain] inbox read failed:", error.message);
    return NextResponse.json({ ok: false, error: "inbox_read_failed" }, { status: 500 });
  }

  // Selection is FIFO by arrival (above), but the WALK must follow the
  // shopper's clock: intent chaining reads each query against the ones before
  // it, and the retry queue can deliver an old event after a newer one. Sorted
  // by occurred_at so a refinement chain is reconstructed in the order it was
  // actually typed; rows with no reported age keep arrival order behind them.
  const rows = ((data ?? []) as InboxRow[]).slice().sort((a, b) => {
    const at = a.occurred_at ?? a.received_at;
    const bt = b.occurred_at ?? b.received_at;
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, drained: 0, searches: 0, events: 0 });
  }

  const searchRows: Record<string, unknown>[] = [];
  const eventRows: Record<string, unknown>[] = [];
  const posthog: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
  const failed: { event_id: string; attempts: number; error: string }[] = [];
  const okIds: string[] = [];

  // Intent grouping needs the session's recent queries. A batch IS a session's
  // run of refinements ("shoe" → "shoes" → "running shoes"), so the rows in
  // THIS batch must chain with each other, not just with what is already in
  // query_log. Hence an in-memory window per (instance, user), seeded from the
  // database once and then appended to as we walk the batch in arrival order.
  // Computing intents after a bulk insert instead would give every search in a
  // visit its own intent id and quietly defeat the whole column.
  const intentCache = new Map<string, RecentQuery[]>();

  async function recentFor(
    instanceId: number,
    userId: string,
    atIso: string,
  ): Promise<RecentQuery[]> {
    const key = `${instanceId}:${userId}`;
    const cached = intentCache.get(key);
    if (cached) return cached;
    // Bounded in time as well as in count, and probes excluded — the same two
    // rules the search route applies, for the same reasons (F-1, F-2). Seeded
    // from the FIRST event of this user's run, which is the earliest thing a
    // query in this batch could legitimately join.
    const since = new Date(Date.parse(atIso) - INTENT_WINDOW_MS).toISOString();
    const { data: recentRows } = await sb
      .from("query_log")
      .select("query, intent_group_id, created_at")
      .eq("instance_id", instanceId)
      .eq("user_id", userId)
      .not("intent_group_id", "is", null)
      .not("is_committed", "is", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(INTENT_WINDOW);
    const window: RecentQuery[] = (recentRows ?? [])
      .filter(
        (r): r is { query: string; intent_group_id: string; created_at: string } =>
          typeof r.query === "string" && typeof r.intent_group_id === "string",
      )
      .map((r) => ({
        query: r.query,
        intentGroupId: r.intent_group_id,
        at: r.created_at,
      }));
    intentCache.set(key, window);
    return window;
  }

  for (const row of rows) {
    try {
      const p = row.payload ?? {};

      // WHEN it happened, not when we got round to moving it. `created_at` is
      // what sessionization's 30-minute gap rule and instance_day()'s KPI
      // bucketing both read, so letting it default to the drain's own clock
      // collapsed every event in a drain window onto one instant (R-33).
      // Falls back to ingest time for a client too old to report an age.
      const createdAt = row.occurred_at ?? row.received_at;

      if (row.kind === "search_performed") {
        const query = str(p.query, 512);
        if (query === null) throw new Error("search_performed without a query");

        const userId = str(p.user_id ?? p.userId, 128);
        const isCommitted =
          typeof p.is_committed === "boolean" ? p.is_committed : null;
        let intentGroupId: string | null = null;
        let reformulationType: string | null = null;
        let previousQuery: string | null = null;
        // A typeahead probe does not mint an intent and does not enter the
        // window (F-2); only a committed search does.
        if (userId && isCommitted !== false) {
          const window = await recentFor(row.instance_id, userId, createdAt);
          const assigned = assignIntent(window, query, createdAt);
          intentGroupId = assigned.intentGroupId;
          reformulationType = assigned.reformulationType;
          previousQuery = assigned.previousQuery;
          // Most-recent-first, so the next search in this batch sees this one.
          window.unshift({ query, intentGroupId, at: createdAt });
          if (window.length > INTENT_WINDOW) window.pop();
        }

        searchRows.push({
          event_id: row.event_id,
          instance_id: row.instance_id,
          created_at: createdAt,
          query,
          // R-26: the page length and the whole-query estimate are two
          // different numbers and now live in two different columns.
          total_hits: int(p.total_hits) ?? 0,
          estimated_total_hits: int(p.estimated_total_hits),
          processing_time_ms: int(p.processing_time_ms) ?? 0,
          origin: row.origin,
          // Direct-mode rows are not proxy requests. status 200 means the
          // search succeeded; denial_reason and total_handler_ms are
          // proxy-only artifacts and stay NULL (see the data model section of
          // the design doc).
          status: 200,
          query_uid: str(p.query_uid ?? p.queryUid, 128),
          user_id: userId,
          account_id: str(p.account_id ?? p.accountId, 128),
          intent_group_id: intentGroupId,
          reformulation_type: reformulationType,
          previous_query: previousQuery,
          is_committed: isCommitted,
          commit_reason: str(p.commit_reason, 64),
        });
      } else {
        const eventType = str(p.eventType ?? row.kind, 64);
        const eventName = str(p.eventName, 256);
        if (!eventType || !eventName) throw new Error("event without eventType/eventName");

        const userId = str(p.userId ?? p.user_id, 128);
        eventRows.push({
          event_id: row.event_id,
          instance_id: row.instance_id,
          created_at: createdAt,
          event_type: eventType,
          event_name: eventName,
          user_id: userId,
          query_uid: str(p.queryUid, 128),
          index_uid: str(p.indexUid, 128),
          object_id: str(p.objectId, 128),
          object_name: str(p.objectName, 512),
          position: int(p.position),
          origin: row.origin,
          account_id: str(p.accountId, 128),
          order_id: str(p.orderId, 128),
          cart_id: str(p.cartId, 128),
          value: typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null,
          quantity: int(p.quantity),
          placement: str(p.placement, 80),
        });

        posthog.push({
          distinctId: userId ?? "anonymous",
          event: eventName,
          properties: {
            event_type: eventType,
            query_uid: str(p.queryUid, 128),
            object_id: str(p.objectId, 128),
            instance_id: row.instance_id,
            drained: true,
          },
        });
      }

      okIds.push(row.event_id);
    } catch (err) {
      // One malformed event must not hold up its neighbours. Park it with the
      // reason attached: a row with a last_error and rising attempts is a
      // poison message, which is a different problem from a backlog.
      failed.push({
        event_id: row.event_id,
        attempts: row.attempts + 1,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Bulk first; on failure fall back to one-by-one so a single bad row cannot
  // reject the whole insert. ignoreDuplicates makes a retried drain a no-op
  // rather than a double count.
  async function writeAll(
    table: "query_log" | "analytics_event",
    payloadRows: Record<string, unknown>[],
  ): Promise<void> {
    if (payloadRows.length === 0) return;
    const { error: bulkError } = await sb
      .from(table)
      .upsert(payloadRows, { onConflict: "event_id", ignoreDuplicates: true });
    if (!bulkError) return;

    console.warn(`[drain] bulk ${table} insert failed, retrying per row:`, bulkError.message);
    for (const one of payloadRows) {
      const { error: rowError } = await sb
        .from(table)
        .upsert([one], { onConflict: "event_id", ignoreDuplicates: true });
      if (rowError) {
        const id = String(one.event_id);
        const idx = okIds.indexOf(id);
        if (idx !== -1) okIds.splice(idx, 1);
        failed.push({ event_id: id, attempts: 1, error: rowError.message });
      }
    }
  }

  await writeAll("query_log", searchRows);
  await writeAll("analytics_event", eventRows);

  // Dormant unless POSTHOG_ENABLED=1 (DEC-5), so this is a no-op today. Never
  // allowed to fail the drain: the durable copy is already written.
  await Promise.allSettled(posthog.map((e) => capturePostHog(e)));

  if (okIds.length > 0) {
    const { error: markError } = await sb
      .from("event_inbox")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .in("event_id", okIds);
    if (markError) {
      // Rows are written but still look pending, so the next run will try them
      // again -- harmless, because every destination insert is keyed on
      // event_id. Loud anyway: left unfixed this is an infinite redelivery.
      console.error("[drain] failed to mark processed:", markError.message);
      await sb.from("backend_operation").insert({
        instance_id: 0,
        operation_type: "event_drain",
        target_id: "mark_processed",
        status: "failed",
        error_message: markError.message,
        payload_summary: { count: okIds.length },
      });
    }
  }

  for (const f of failed) {
    await sb
      .from("event_inbox")
      .update({ attempts: f.attempts, last_error: f.error.slice(0, 1000) })
      .eq("event_id", f.event_id);
  }

  if (failed.length > 0) {
    await sb.from("backend_operation").insert({
      instance_id: 0,
      operation_type: "event_drain",
      target_id: "event_inbox",
      status: "failed",
      error_message: `${failed.length} event(s) could not be drained`,
      payload_summary: { sample: failed.slice(0, 5) },
    });
  }

  return NextResponse.json({
    ok: true,
    drained: okIds.length,
    searches: searchRows.length,
    events: eventRows.length,
    failed: failed.length,
  });
}
