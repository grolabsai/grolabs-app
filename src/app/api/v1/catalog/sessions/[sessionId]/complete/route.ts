import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { completeSession, parseSessionId } from "@/lib/byo/session";

export const runtime = "nodejs";

/**
 * Mark an intake session complete ("that's everything").
 *
 *   POST /api/v1/catalog/sessions/{sessionId}/complete  { instance_id }
 *
 * Flips the session from 'collecting' to 'review' and returns a summary of what
 * landed (row counts per part_role). Interpretation (P5) + the confirm loop (P6)
 * consume review-state sessions once built. Plan: P3.
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

  const result = await completeSession(auth.sb, auth.instanceId, jobId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json(
    { session_id: jobId, status: "review", summary: result.summary },
    { status: 200 },
  );
}
