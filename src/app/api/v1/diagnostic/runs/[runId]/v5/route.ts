import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

function json(status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * GET /api/v1/diagnostic/runs/{runId}/v5
 *
 * Poll for v5 diagnostic results after firing the async POST.
 * Returns { status: "processing" } while the background job runs,
 * then { status: "completed", categories: [...] } when done.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const supabase = createServiceRoleClient();

  // Check run status
  const { data: run } = await supabase
    .from("diagnostic_run")
    .select("run_id, run_status, instance_id")
    .eq("run_id", runId)
    .maybeSingle();

  if (!run) return json(404, { error: "not_found" });
  if (run.instance_id !== null) return json(404, { error: "not_found" });

  if (run.run_status === "running" || run.run_status === "pending") {
    return json(202, { run_id: runId, status: "processing" });
  }

  // Load category scores + findings from DB
  const { data: scores } = await supabase
    .from("run_category_score")
    .select("diagnostic_category_id, score, est_annual_uplift_usd")
    .eq("run_id", runId);

  const { data: findings } = await supabase
    .from("finding")
    .select("diagnostic_check_id, result_status, score, evidence")
    .eq("run_id", runId)
    .eq("instance_id", 0);

  // Load category metadata
  const categoryIds = (scores ?? []).map((s) => s.diagnostic_category_id);
  const { data: categories } = categoryIds.length
    ? await supabase
        .from("diagnostic_category")
        .select("diagnostic_category_id, category_code, stage_code")
        .in("diagnostic_category_id", categoryIds)
    : { data: [] };

  // Load check order for finding mapping
  const { data: checks } = await supabase
    .from("diagnostic_check")
    .select("diagnostic_check_id, check_code, diagnostic_category_id")
    .eq("instance_id", 0);

  const checkMap = new Map((checks ?? []).map((c) => [c.diagnostic_check_id, c]));
  const catMeta = new Map((categories ?? []).map((c) => [c.diagnostic_category_id, c]));

  // Build category results grouped by category_code
  const byCategory = new Map<string, { score: number | null; findings: unknown[] }>();
  for (const s of scores ?? []) {
    const meta = catMeta.get(s.diagnostic_category_id);
    if (!meta) continue;
    byCategory.set(meta.category_code, { score: s.score, findings: [] });
  }
  for (const f of findings ?? []) {
    const check = checkMap.get(f.diagnostic_check_id);
    if (!check) continue;
    const cat = catMeta.get(check.diagnostic_category_id);
    if (!cat) continue;
    const entry = byCategory.get(cat.category_code);
    if (entry) entry.findings.push({ status: f.result_status, score: f.score, evidence: f.evidence });
  }

  return json(200, {
    run_id: runId,
    status: "completed",
    categories: Array.from(byCategory.entries()).map(([code, data]) => ({
      category_code: code,
      score: data.score,
      findings: data.findings,
    })),
  });
}
