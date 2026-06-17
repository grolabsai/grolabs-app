import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { addParts, parseSessionId, MAX_PART_RECORDS } from "@/lib/byo/session";

export const runtime = "nodejs";

/**
 * Upload one part of an intake session — lands raw, verbatim, accept-fast.
 *
 *   POST /api/v1/catalog/sessions/{sessionId}/parts
 *     { instance_id, part_role?, records[] }
 *
 * `part_role` (e.g. "products", "variants", "categories") tags the rows so the
 * stitch step can reassemble product objects from a multi-table dump. Omit it
 * when sending whole product objects. Plan: P3.
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
  const b = body as { instance_id?: unknown; part_role?: unknown; records?: unknown };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  const jobId = parseSessionId(sessionId);
  if (jobId === null) {
    return NextResponse.json({ error: "invalid_session_id" }, { status: 400 });
  }
  if (!Array.isArray(b.records)) {
    return NextResponse.json({ error: "records_required" }, { status: 400 });
  }
  if (b.records.length === 0) {
    return NextResponse.json({ error: "records_empty" }, { status: 400 });
  }
  if (b.records.length > MAX_PART_RECORDS) {
    return NextResponse.json(
      { error: "part_too_large", message: `max ${MAX_PART_RECORDS} records per part` },
      { status: 400 },
    );
  }

  const partRole =
    typeof b.part_role === "string" && b.part_role.length > 0 ? b.part_role : null;

  const result = await addParts(
    auth.sb,
    auth.instanceId,
    jobId,
    partRole,
    b.records as Record<string, unknown>[],
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json(
    { accepted: result.accepted, total_rows: result.totalRows },
    { status: 202 },
  );
}
