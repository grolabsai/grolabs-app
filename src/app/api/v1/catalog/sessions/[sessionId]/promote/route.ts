import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import { promoteAccepted } from "@/lib/byo/promote";

export const runtime = "nodejs";

/**
 * Promote a session's ACCEPTED proposals into the live catalog (the one
 * production write).
 *
 *   POST /api/v1/catalog/sessions/{sessionId}/promote  { instance_id }
 *
 * Creates product (+ variant) rows from accepted variant_structure suggestions,
 * resolving brand via the existing case-insensitive dedup. Idempotent — only
 * accepted-and-not-yet-promoted suggestions are written. Write-key authenticated.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as { instance_id?: unknown };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  const jobId = parseSessionId(sessionId);
  if (jobId === null) {
    return NextResponse.json({ error: "invalid_session_id" }, { status: 400 });
  }

  const result = await promoteAccepted(auth.sb, auth.instanceId, jobId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "promote_failed", message: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json(result.result, { status: 201 });
}
