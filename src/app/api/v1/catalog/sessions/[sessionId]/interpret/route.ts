import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWriteKey } from "@/lib/byo/auth";
import { parseSessionId } from "@/lib/byo/session";
import {
  stitchProductObjects,
  type StagingRow,
  type DataDictionary,
} from "@/lib/byo/stitch";
import { analyzeCategories, type ProductIn } from "@/lib/ase";

export const runtime = "nodejs";

const MAX_STITCH_ROWS = 5000;
const MAX_INTERPRET_PRODUCTS = 200;

/**
 * Interpret a session's products (P5, first slice): stitch the landed parts into
 * product objects and ask ASE to infer a category per product, returning
 * confidence-tiered suggestions — the "I found this" data the confirm loop (P6)
 * will act on.
 *
 *   POST /api/v1/catalog/sessions/{sessionId}/interpret
 *     { instance_id, candidates? }
 *
 * Categories come from the instance's catalog by default; pass `candidates`
 * (inline category list) to interpret against an explicit set (sandbox/tests).
 * Write-key authenticated. Calls the live ASE service.
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
  const b = body as { instance_id?: unknown; candidates?: unknown };

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
      { error: "interpret_failed", message: jobErr.message },
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
      { error: "interpret_failed", message: error.message },
      { status: 500 },
    );
  }

  const { products } = stitchProductObjects(
    (rows ?? []) as StagingRow[],
    (job as { data_dictionary: unknown }).data_dictionary as DataDictionary,
  );

  // Map to ASE's ProductIn — needs a stable ref + a name to reason over.
  const productsIn: ProductIn[] = [];
  for (const p of products) {
    const ref = p.id != null ? String(p.id) : null;
    const name =
      typeof p.title === "string" && p.title.length > 0
        ? p.title
        : typeof p.name === "string"
          ? p.name
          : "";
    if (!ref || name.length === 0) continue;
    productsIn.push({
      product_ref: ref,
      name,
      brand: typeof p.brand === "string" ? p.brand : null,
      photo_url: typeof p.image === "string" ? p.image : null,
    });
    if (productsIn.length >= MAX_INTERPRET_PRODUCTS) break;
  }

  if (productsIn.length === 0) {
    return NextResponse.json({
      count: 0,
      suggestions: [],
      note: "no products with both an id and a name to interpret",
    });
  }

  const candidates = Array.isArray(b.candidates)
    ? (b.candidates as Array<{
        category_id: number | string;
        name: string;
        parent_id?: number | string | null;
        slug?: string | null;
        parsing_hint?: string | null;
      }>)
    : undefined;

  try {
    const result = await analyzeCategories({
      products: productsIn,
      instanceId: candidates ? undefined : auth.instanceId,
      candidates,
    });
    return NextResponse.json({
      count: productsIn.length,
      model_used: result.model_used,
      suggestions: result.suggestions,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "interpret_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
