/**
 * Backend-call observability recorder.
 *
 * Every discrete call into an external backend (Meilisearch indexing,
 * WooCommerce pull, settings push, …) opens a `backend_operation` row in
 * `pending`, then closes it `succeeded` / `failed` / `partial` once the
 * REAL outcome is known — for Meilisearch that means after polling the task
 * to completion, not when the task was merely enqueued.
 *
 * Writes go through the service-role client: indexing runs from server
 * actions and cron where the user JWT is absent or single-instance scoped,
 * and the table has no INSERT/UPDATE RLS policy by design.
 *
 * Recording is best-effort: a failure to write the audit row must never
 * break the underlying operation, so every helper swallows its own errors
 * and logs to the server console instead.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type BackendOperationStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "partial";

const TABLE = "backend_operation";

/** Open a pending operation row. Returns the operation_id, or null if the
 * audit insert failed (callers treat null as "no row" and skip completion). */
export async function startBackendOperation(input: {
  instanceId: number;
  operationType: string;
  targetId?: string | null;
  payloadSummary?: Record<string, unknown> | null;
}): Promise<number | null> {
  try {
    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from(TABLE)
      .insert({
        instance_id: input.instanceId,
        operation_type: input.operationType,
        target_id: input.targetId ?? null,
        payload_summary: input.payloadSummary ?? null,
        status: "pending",
      })
      .select("operation_id")
      .single();
    if (error || !data) {
      console.error("[backend-operation] start failed:", error?.message);
      return null;
    }
    return (data as { operation_id: number }).operation_id;
  } catch (err) {
    console.error(
      "[backend-operation] start threw:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Close an operation with a terminal status, recording the full backend
 * response and computing duration_ms from `startedAtMs`. */
export async function completeBackendOperation(
  operationId: number | null,
  input: {
    status: Exclude<BackendOperationStatus, "pending">;
    responsePayload?: unknown;
    errorMessage?: string | null;
    startedAtMs?: number;
  },
): Promise<void> {
  if (operationId === null) return;
  try {
    const sb = createServiceRoleClient();
    const durationMs =
      input.startedAtMs != null
        ? Math.max(0, Date.now() - input.startedAtMs)
        : null;
    const { error } = await sb
      .from(TABLE)
      .update({
        status: input.status,
        response_payload: (input.responsePayload ?? null) as never,
        error_message: input.errorMessage ?? null,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("operation_id", operationId);
    if (error) {
      console.error("[backend-operation] complete failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[backend-operation] complete threw:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Record a one-shot operation that resolved synchronously (no polling) —
 * e.g. a product skipped because it has no WooCommerce id yet. Opens and
 * immediately closes the row in a single logical step. */
export async function recordBackendOperation(input: {
  instanceId: number;
  operationType: string;
  targetId?: string | null;
  payloadSummary?: Record<string, unknown> | null;
  status: Exclude<BackendOperationStatus, "pending">;
  responsePayload?: unknown;
  errorMessage?: string | null;
  startedAtMs?: number;
}): Promise<void> {
  const opId = await startBackendOperation({
    instanceId: input.instanceId,
    operationType: input.operationType,
    targetId: input.targetId,
    payloadSummary: input.payloadSummary,
  });
  await completeBackendOperation(opId, {
    status: input.status,
    responsePayload: input.responsePayload,
    errorMessage: input.errorMessage,
    startedAtMs: input.startedAtMs,
  });
}

/** Annotate a still-pending operation with the enqueued task uid when it
 * times out before confirmation. Status stays `pending` and completed_at
 * stays NULL so a later sync / background poller can resolve it. */
export async function noteBackendOperationPending(
  operationId: number | null,
  responsePayload: unknown,
): Promise<void> {
  if (operationId === null) return;
  try {
    const sb = createServiceRoleClient();
    const { error } = await sb
      .from(TABLE)
      .update({ response_payload: responsePayload as never })
      .eq("operation_id", operationId);
    if (error) {
      console.error("[backend-operation] note-pending failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[backend-operation] note-pending threw:",
      err instanceof Error ? err.message : err,
    );
  }
}
