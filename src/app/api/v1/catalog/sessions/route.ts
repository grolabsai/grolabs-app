import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { openSession } from "@/lib/byo/session";

export const runtime = "nodejs";

/**
 * Open a multi-part intake session.
 *
 *   POST /api/v1/catalog/sessions
 *     { instance_id, source_type?, data_dictionary?, filename? }
 *
 * Write-key authenticated. Returns a `session_id` to upload parts against, then
 * mark complete. Reuses import_job (status 'collecting'). Plan: P3.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as {
    instance_id?: unknown;
    source_type?: unknown;
    data_dictionary?: unknown;
    filename?: unknown;
  };

  const auth = await authenticateWriteKey(req, b.instance_id);
  if (!auth.ok) return auth.response;

  const result = await openSession(auth.sb, auth.instanceId, {
    sourceType: typeof b.source_type === "string" ? b.source_type : undefined,
    dataDictionary: b.data_dictionary ?? null,
    filename: typeof b.filename === "string" ? b.filename : null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "session_create_failed", message: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json(
    {
      session_id: result.session.job_id,
      status: result.session.status,
      source_type: result.session.source_type,
    },
    { status: 201 },
  );
}
