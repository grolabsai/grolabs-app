import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * GET /api/v1/diagnostic/runs/{runId}
 *
 * Public, anonymous-readable summary of a diagnostic run. Only exposes
 * anonymous runs (instance_id IS NULL) — authenticated-instance runs are
 * not reachable via this route (the Scout admin has its own /prospects
 * UI for those). The unguessable UUID acts as the share token.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "diagnostic_not_configured" });
  }
  const supabase = createServiceRoleClient();

  const { data: run, error: runErr } = await supabase
    .from("diagnostic_run")
    .select(
      "run_id, prospect_id, instance_id, run_status, started_at, completed_at, overall_score, stage_scores, maturity_tier, est_annual_uplift_usd, error_message",
    )
    .eq("run_id", runId)
    .maybeSingle();

  if (runErr) return json(500, { error: runErr.message });
  if (!run) return json(404, { error: "not_found" });
  if (run.instance_id !== null) {
    return json(404, { error: "not_found" });
  }

  const { data: prospect } = await supabase
    .from("prospect")
    .select("prospect_id, url, display_name, vertical_id, platform_detected, engine_detected")
    .eq("prospect_id", run.prospect_id)
    .maybeSingle();

  const { data: findings } = await supabase
    .from("finding")
    .select(
      "finding_id, diagnostic_check_id, score, result_status, evidence, notes",
    )
    .eq("run_id", runId);

  return json(200, {
    run,
    prospect,
    findings: findings ?? [],
  });
}
