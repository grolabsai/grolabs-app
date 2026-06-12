import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { ingestDelete, MAX_INGEST_BATCH } from "@/lib/byo/ingest";

export const runtime = "nodejs";

/**
 * External-platform (BYO) batch document deletion by id.
 *
 *   POST /api/v1/catalog/documents/delete   { instance_id, ids[] }
 *
 * Write-key authenticated. A POST (not DELETE) because the id list travels in
 * the body. Mirrors Meilisearch's "delete documents by batch" endpoint.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as { instance_id?: unknown; ids?: unknown };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  if (!Array.isArray(b.ids) || b.ids.length === 0) {
    return NextResponse.json({ error: "ids_required" }, { status: 400 });
  }
  if (b.ids.length > MAX_INGEST_BATCH) {
    return NextResponse.json(
      {
        error: "batch_too_large",
        message: `max ${MAX_INGEST_BATCH} ids per request`,
      },
      { status: 400 },
    );
  }

  const ids = b.ids.filter(
    (x): x is string | number => typeof x === "string" || typeof x === "number",
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids_required" }, { status: 400 });
  }

  const result = await ingestDelete(auth.sb, auth.instanceId, ids);
  if (!result.ok) {
    return NextResponse.json(
      { error: "ingest_failed", message: result.error, task_id: result.taskId },
      { status: 500 },
    );
  }
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
