import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { getTaskStatus } from "@/lib/search/meilisearch-client";

export const runtime = "nodejs";

/**
 * External-platform (BYO) ingestion task status.
 *
 *   GET /api/v1/catalog/tasks/{taskId}?instance_id=N
 *
 * Write-key authenticated. Reads the GroLabs ledger row. If the row is still
 * `processing` and carries a Meilisearch task uid, we refresh the real terminal
 * state from Meilisearch and persist it — so polling converges to
 * succeeded/failed without a separate worker. Mirrors Meilisearch's Tasks API.
 */

const TASK_COLUMNS =
  "task_id, op, status, document_count, failed_count, meilisearch_task_uid, error, created_at, completed_at";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await ctx.params;
  const auth = await authenticateWriteKey(
    req,
    req.nextUrl.searchParams.get("instance_id"),
  );
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.sb
    .from("catalog_ingestion_task")
    .select(TASK_COLUMNS)
    .eq("instance_id", auth.instanceId)
    .eq("task_id", taskId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "task_read_failed", message: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let row = data as Record<string, unknown>;

  // Converge a still-processing row to its terminal state by consulting
  // Meilisearch directly. Best-effort: a refresh failure just returns the
  // last known row.
  if (row.status === "processing" && row.meilisearch_task_uid != null) {
    try {
      const ms = await getTaskStatus(Number(row.meilisearch_task_uid));
      if (ms.status === "succeeded" || ms.status === "failed") {
        const { data: updated } = await auth.sb
          .from("catalog_ingestion_task")
          .update({
            status: ms.status,
            error: ms.error
              ? { code: ms.error.code, message: ms.error.message }
              : (row.error ?? null),
            completed_at: new Date().toISOString(),
          })
          .eq("instance_id", auth.instanceId)
          .eq("task_id", taskId)
          .select(TASK_COLUMNS)
          .single();
        if (updated) row = updated as Record<string, unknown>;
      }
    } catch {
      /* keep last-known row */
    }
  }

  return NextResponse.json(row);
}
