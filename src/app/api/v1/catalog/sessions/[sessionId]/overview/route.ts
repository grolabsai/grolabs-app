import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import {
  stitchProductObjects,
  type StagingRow,
  type DataDictionary,
} from "@/lib/byo/stitch";
import { profileProducts } from "@/lib/byo/profile";

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;

/**
 * Overview / totals for a session (Stage 2) — the macro reconciliation.
 *
 *   GET /api/v1/catalog/sessions/{sessionId}/overview?instance_id=N
 *
 * Counts products + variants, reports field coverage (% populated), and surfaces
 * value distributions for categorical fields (auto-surfacing brands, categories,
 * statuses, sizes…). No AI — pure counting the merchant uses to confirm the
 * received data matches what they believe they have. Write-key authenticated.
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

  const { data: job, error: jobErr } = await auth.sb
    .from("import_job")
    .select("job_id, data_dictionary")
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) {
    return NextResponse.json(
      { error: "overview_failed", message: jobErr.message },
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
      { error: "overview_failed", message: error.message },
      { status: 500 },
    );
  }

  const { products } = stitchProductObjects(
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );

  const profile = profileProducts(products);

  return NextResponse.json({
    truncated: (rows?.length ?? 0) >= MAX_STITCH_ROWS,
    ...profile,
  });
}
