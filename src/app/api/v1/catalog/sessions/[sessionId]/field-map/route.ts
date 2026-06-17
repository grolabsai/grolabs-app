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

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;

/**
 * Infer a field map for a session (Stage 3) — which merchant fields map to our
 * canonical ProductObject fields — and show a before/after sample.
 *
 *   GET /api/v1/catalog/sessions/{sessionId}/field-map?instance_id=N&limit=3
 *
 * Pure, no AI. This is the proposal the confirm step acts on; it's what turns
 * `sku`/`Nombre`/`Marca`/`Precio` into canonical `id`/`title`/`brand`/`price` so
 * the rest of the pipeline can run on unstructured data. Read-only.
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
    Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 20 ? limitRaw : 3;

  const { data: job, error: jobErr } = await auth.sb
    .from("import_job")
    .select("job_id, data_dictionary")
    .eq("instance_id", auth.instanceId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobErr) {
    return NextResponse.json(
      { error: "field_map_failed", message: jobErr.message },
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
      { error: "field_map_failed", message: error.message },
      { status: 500 },
    );
  }

  const { products } = stitchProductObjects(
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );

  const { mapping, unmapped } = inferFieldMap(products);

  const sample = products.slice(0, limit).map((p) => ({
    before: p,
    after: applyFieldMap(p, mapping),
  }));

  return NextResponse.json({ mapping, unmapped, sample });
}
