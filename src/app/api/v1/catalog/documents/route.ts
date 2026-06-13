import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import {
  ingestUpsert,
  ingestDeleteAll,
  MAX_INGEST_BATCH,
  type IngestOutcome,
} from "@/lib/byo/ingest";
import type { IngestDocument } from "@/lib/byo/map-document";

export const runtime = "nodejs";

/**
 * External-platform (BYO) catalog documents.
 *
 *   POST   /api/v1/catalog/documents          { instance_id, documents[], primary_key? }
 *   DELETE /api/v1/catalog/documents?instance_id=N   (delete the whole catalog)
 *
 * Write-key authenticated, server-to-server (no Origin/CORS — the key is the
 * boundary). Mirrors Meilisearch's Documents API. Accept-fast: the Meilisearch
 * index task runs async; the returned `task_id` is the GroLabs ledger row to
 * poll via /api/v1/catalog/tasks/{task_id}.
 */

/** Shared 202 acknowledgement shape (matches @grolabs/web-sdk IngestAck). */
function ack(result: Extract<IngestOutcome, { ok: true }>): NextResponse {
  return NextResponse.json(
    {
      task_id: result.taskId,
      accepted: result.accepted,
      rejected: result.rejected,
      meilisearch_task_uid: result.meilisearchTaskUid,
    },
    { status: 202 },
  );
}

function ingestError(result: Extract<IngestOutcome, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: "ingest_failed", message: result.error, task_id: result.taskId },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as {
    instance_id?: unknown;
    documents?: unknown;
    primary_key?: unknown;
  };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  if (!Array.isArray(b.documents)) {
    return NextResponse.json({ error: "documents_required" }, { status: 400 });
  }
  if (b.documents.length === 0) {
    return NextResponse.json({ error: "documents_empty" }, { status: 400 });
  }
  if (b.documents.length > MAX_INGEST_BATCH) {
    return NextResponse.json(
      {
        error: "batch_too_large",
        message: `max ${MAX_INGEST_BATCH} documents per request`,
      },
      { status: 400 },
    );
  }

  const primaryKey =
    typeof b.primary_key === "string" && b.primary_key.length > 0
      ? b.primary_key
      : "id";

  const result = await ingestUpsert(
    auth.sb,
    auth.instanceId,
    b.documents as IngestDocument[],
    primaryKey,
  );
  return result.ok ? ack(result) : ingestError(result);
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticateWriteKey(
    req,
    req.nextUrl.searchParams.get("instance_id"),
  );
  if (!auth.ok) return auth.response;

  const result = await ingestDeleteAll(auth.sb, auth.instanceId);
  return result.ok ? ack(result) : ingestError(result);
}
