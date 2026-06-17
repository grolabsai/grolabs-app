import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import {
  stitchProductObjects,
  type StagingRow,
  type DataDictionary,
} from "@/lib/byo/stitch";

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;

/**
 * Preview the product objects reassembled from a session's landed parts (P4).
 *
 *   GET /api/v1/catalog/sessions/{sessionId}/preview?instance_id=N&limit=25
 *
 * Read-only. Stitches staging rows (whole objects pass through; multi-table
 * dumps are joined by link key from the session's data_dictionary) and returns
 * the assembled product objects so a client can confirm the shape before the
 * interpretation + confirm steps (P5/P6). Write-key authenticated.
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

  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 25;

  const { data: job, error: jobErr } = await auth.sb
    .from("import_job")
    .select("job_id, data_dictionary")
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) {
    return NextResponse.json(
      { error: "preview_failed", message: jobErr.message },
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
      { error: "preview_failed", message: error.message },
      { status: 500 },
    );
  }

  const { products, unlinked } = stitchProductObjects(
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );

  return NextResponse.json({
    count: products.length,
    truncated: (rows?.length ?? 0) >= MAX_STITCH_ROWS,
    unlinked,
    products: products.slice(0, limit),
  });
}
