import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";

export const runtime = "nodejs";

const COLUMNS =
  "suggestion_id, suggestion_type, source_function, entity_type, confidence, payload, status, reviewed_at, editor_notes, created_at";

/**
 * List a session's proposals from catalog_suggestion (the confirm queue).
 *
 *   GET /api/v1/catalog/sessions/{sessionId}/suggestions?instance_id=N&status=pending
 *
 * Optional `status` filter (pending|accepted|edited|rejected). Write-key auth.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  const auth = await authenticateWriteKey(
    req,
    req.nextUrl.searchParams.get("instance_id"),
  );
  if (!auth.ok) return auth.response;

  const jobId = parseSessionId(sessionId);
  if (jobId === null) {
    return NextResponse.json({ error: "invalid_session_id" }, { status: 400 });
  }

  let q = auth.sb
    .from("catalog_suggestion")
    .select(COLUMNS)
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .order("suggestion_id");

  const status = req.nextUrl.searchParams.get("status");
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: "suggestions_read_failed", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ count: (data ?? []).length, suggestions: data ?? [] });
}
