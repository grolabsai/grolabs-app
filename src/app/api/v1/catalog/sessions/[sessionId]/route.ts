import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { getSession, parseSessionId } from "@/lib/byo/session";

export const runtime = "nodejs";

/**
 * Read an intake session's status + a summary of what landed.
 *
 *   GET /api/v1/catalog/sessions/{sessionId}?instance_id=N
 *
 * Write-key authenticated. Plan: P3.
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

  const result = await getSession(auth.sb, auth.instanceId, jobId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ session: result.session, summary: result.summary });
}
