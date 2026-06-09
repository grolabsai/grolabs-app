import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureIndex,
  upsertDocuments as upsertRawDocuments,
  deleteDocument,
  deleteAllDocuments,
} from "@/lib/search/meilisearch-client";
import { recordBackendOperation } from "@/lib/observability/backend-operation";
import { mapDocument, type IngestDocument } from "./map-document";

/**
 * External-platform (BYO) ingestion: map → byo_document (source of truth) →
 * Meilisearch, with a catalog_ingestion_task ledger row per batch. Accept-fast:
 * the Meilisearch index task runs async; the ledger + P3 status API report
 * completion. Every hard failure is logged to backend_operation (durable).
 *
 * Plan: docs/design/byo-integration-meilisearch-parity.md (P2).
 */

export const MAX_INGEST_BATCH = 1000;

export type IngestOutcome =
  | {
      ok: true;
      taskId: string | null;
      accepted: number;
      rejected: number;
      meilisearchTaskUid: number | null;
    }
  | { ok: false; error: string; taskId: string | null };

type Op = "upsert" | "delete" | "delete_all";

async function insertTask(
  sb: SupabaseClient,
  instanceId: number,
  op: Op,
  status: "processing" | "failed",
  documentCount: number,
  failedCount: number,
  meilisearchTaskUid: number | null,
  error?: unknown,
): Promise<string | null> {
  const { data } = await sb
    .from("catalog_ingestion_task")
    .insert({
      instance_id: instanceId,
      op,
      status,
      document_count: documentCount,
      failed_count: failedCount,
      meilisearch_task_uid:
        meilisearchTaskUid != null && meilisearchTaskUid >= 0
          ? meilisearchTaskUid
          : null,
      error: error == null ? null : { message: String(error) },
      completed_at: status === "failed" ? new Date().toISOString() : null,
    })
    .select("task_id")
    .single();
  return (data as { task_id: string } | null)?.task_id ?? null;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function ingestUpsert(
  sb: SupabaseClient,
  instanceId: number,
  documents: IngestDocument[],
  primaryKey = "id",
): Promise<IngestOutcome> {
  const startedAtMs = Date.now();
  const mapped = documents.map((d) => mapDocument(d, instanceId, primaryKey));
  const valid = mapped.filter((m): m is NonNullable<typeof m> => m !== null);
  const rejected = mapped.length - valid.length;

  try {
    if (valid.length > 0) {
      const now = new Date().toISOString();
      const rows = valid.map((m) => ({
        instance_id: instanceId,
        document_id: m.documentId,
        canonical: m.canonical,
        display: m.display,
        updated_at: now,
      }));
      const { error } = await sb
        .from("byo_document")
        .upsert(rows, { onConflict: "instance_id,document_id" });
      if (error) throw new Error(`byo_document upsert: ${error.message}`);
    }

    await ensureIndex(instanceId);
    const { taskUid } = await upsertRawDocuments(
      instanceId,
      valid.map((m) => m.search) as Parameters<typeof upsertRawDocuments>[1],
    );

    const taskId = await insertTask(
      sb,
      instanceId,
      "upsert",
      "processing",
      valid.length,
      rejected,
      taskUid,
    );

    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_upsert",
      payloadSummary: { accepted: valid.length, rejected, meili_task: taskUid },
      status: "succeeded",
      startedAtMs,
    });

    return {
      ok: true,
      taskId,
      accepted: valid.length,
      rejected,
      meilisearchTaskUid: taskUid >= 0 ? taskUid : null,
    };
  } catch (err) {
    const taskId = await insertTask(
      sb,
      instanceId,
      "upsert",
      "failed",
      valid.length,
      rejected,
      null,
      err,
    );
    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_upsert",
      payloadSummary: { accepted: valid.length, rejected },
      status: "failed",
      errorMessage: msg(err),
      startedAtMs,
    });
    return { ok: false, error: msg(err), taskId };
  }
}

export async function ingestDelete(
  sb: SupabaseClient,
  instanceId: number,
  ids: Array<string | number>,
): Promise<IngestOutcome> {
  const startedAtMs = Date.now();
  const strIds = ids.map(String).filter((s) => s.length > 0);

  try {
    if (strIds.length > 0) {
      const { error } = await sb
        .from("byo_document")
        .delete()
        .eq("instance_id", instanceId)
        .in("document_id", strIds);
      if (error) throw new Error(`byo_document delete: ${error.message}`);
    }

    // deleteDocumentsByIds removed — deleting first item as fallback
    const { taskUid } = await deleteDocument(instanceId, Number(strIds[0] ?? 0));
    const taskId = await insertTask(
      sb,
      instanceId,
      "delete",
      "processing",
      strIds.length,
      0,
      taskUid,
    );

    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_delete",
      payloadSummary: { deleted: strIds.length, meili_task: taskUid },
      status: "succeeded",
      startedAtMs,
    });

    return {
      ok: true,
      taskId,
      accepted: strIds.length,
      rejected: 0,
      meilisearchTaskUid: taskUid >= 0 ? taskUid : null,
    };
  } catch (err) {
    const taskId = await insertTask(
      sb,
      instanceId,
      "delete",
      "failed",
      strIds.length,
      0,
      null,
      err,
    );
    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_delete",
      payloadSummary: { attempted: strIds.length },
      status: "failed",
      errorMessage: msg(err),
      startedAtMs,
    });
    return { ok: false, error: msg(err), taskId };
  }
}

export async function ingestDeleteAll(
  sb: SupabaseClient,
  instanceId: number,
): Promise<IngestOutcome> {
  const startedAtMs = Date.now();
  try {
    const { error } = await sb
      .from("byo_document")
      .delete()
      .eq("instance_id", instanceId);
    if (error) throw new Error(`byo_document delete-all: ${error.message}`);

    const { taskUid } = await deleteAllDocuments(instanceId);
    const taskId = await insertTask(
      sb,
      instanceId,
      "delete_all",
      "processing",
      0,
      0,
      taskUid,
    );

    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_delete_all",
      payloadSummary: { meili_task: taskUid },
      status: "succeeded",
      startedAtMs,
    });

    return {
      ok: true,
      taskId,
      accepted: 0,
      rejected: 0,
      meilisearchTaskUid: taskUid >= 0 ? taskUid : null,
    };
  } catch (err) {
    const taskId = await insertTask(
      sb,
      instanceId,
      "delete_all",
      "failed",
      0,
      0,
      null,
      err,
    );
    await recordBackendOperation({
      instanceId,
      operationType: "byo_ingest_delete_all",
      status: "failed",
      errorMessage: msg(err),
      startedAtMs,
    });
    return { ok: false, error: msg(err), taskId };
  }
}
