import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { getDocumentCount } from "@/lib/search/meilisearch-client";

export const runtime = "nodejs";

/**
 * External-platform (BYO) catalog sync summary.
 *
 *   GET /api/v1/catalog/summary?instance_id=N
 *
 * Write-key authenticated. A merchant's dashboard view of their catalog sync:
 * how many documents are live in the search index vs stored as source of truth,
 * the most recent ingestion task, and any recent failures. Read-only.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateWriteKey(
    req,
    req.nextUrl.searchParams.get("instance_id"),
  );
  if (!auth.ok) return auth.response;

  // Live document count in the Meilisearch index. Best-effort — a missing
  // index (never ingested) reports 0 rather than erroring.
  let indexCount = 0;
  try {
    indexCount = await getDocumentCount(auth.instanceId);
  } catch {
    indexCount = 0;
  }

  // Source-of-truth count from byo_document.
  const { count: storedCount } = await auth.sb
    .from("byo_document")
    .select("document_id", { count: "exact", head: true })
    .eq("instance_id", auth.instanceId);

  const { data: lastTask } = await auth.sb
    .from("catalog_ingestion_task")
    .select(
      "task_id, op, status, document_count, failed_count, meilisearch_task_uid, created_at, completed_at",
    )
    .eq("instance_id", auth.instanceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recentFailures } = await auth.sb
    .from("catalog_ingestion_task")
    .select("task_id, op, error, document_count, created_at")
    .eq("instance_id", auth.instanceId)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    index_document_count: indexCount,
    stored_document_count: storedCount ?? 0,
    last_task: lastTask ?? null,
    recent_failures: recentFailures ?? [],
  });
}
