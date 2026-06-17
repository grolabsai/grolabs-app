import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import {
  stitchProductObjects,
  type StagingRow,
  type DataDictionary,
} from "@/lib/byo/stitch";
import { inferFieldMap, applyFieldMap } from "@/lib/byo/field-map";
import { groupVariants } from "@/lib/byo/group";

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;

/**
 * Group a session's rows into base products + variants (deterministic, no AI).
 *
 *   GET /api/v1/catalog/sessions/{sessionId}/group?instance_id=N&limit=25
 *
 * Pipeline: stitch → apply the inferred field map (so title/id are canonical) →
 * group rows that share a title into one product, with the fields that vary
 * across them becoming variant axes. Read-only. The full assembled shape a
 * merchant confirms before promote.
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
      { error: "group_failed", message: jobErr.message },
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
      { error: "group_failed", message: error.message },
      { status: 500 },
    );
  }

  const { products } = stitchProductObjects(
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );

  // field-map first so grouping keys (title/id) are canonical
  const { mapping } = inferFieldMap(products);
  const mapped = products.map((p) => applyFieldMap(p, mapping));

  const { input, grouped, products: result } = groupVariants(mapped);

  return NextResponse.json({
    truncated: (rows?.length ?? 0) >= MAX_STITCH_ROWS,
    input_rows: input,
    grouped_products: grouped,
    products: result.slice(0, limit),
  });
}
