import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import type { StagingRow, DataDictionary } from "@/lib/byo/stitch";
import { generateProposals } from "@/lib/byo/suggestions";

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;

/**
 * Generate + persist refinement proposals for a session into catalog_suggestion
 * (the confirm store). Idempotent — replaces prior pending proposals.
 *
 *   POST /api/v1/catalog/sessions/{sessionId}/propose  { instance_id }
 *
 * Writes a session-level `column_mapping` proposal + one `variant_structure`
 * proposal per grouped product, all `pending`. List them via …/suggestions and
 * accept/reject via /catalog/suggestions/decision. Write-key authenticated.
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

  const { data: job, error: jobErr } = await auth.sb
    .from("import_job")
    .select("job_id, data_dictionary")
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) {
    return NextResponse.json(
      { error: "propose_failed", message: jobErr.message },
      { status: 500 },
    );
  }
  if (!job) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const { data: rows, error } = await auth.sb
    .from("import_staging")
    .select("raw_data, part_role")
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .order("row_number")
    .limit(MAX_STITCH_ROWS);
  if (error) {
    return NextResponse.json(
      { error: "propose_failed", message: error.message },
      { status: 500 },
    );
  }

  const result = await generateProposals(
    auth.sb,
    auth.instanceId,
    jobId,
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: "propose_failed", message: result.error },
      { status: 500 },
    );
  }
  return NextResponse.json(result.result, { status: 201 });
}
