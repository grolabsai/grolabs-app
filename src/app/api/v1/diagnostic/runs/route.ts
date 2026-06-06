import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { startAnonymousDiagnostic } from "@/lib/diagnostic/runner";
import { runV5Diagnostic } from "@/lib/diagnostic/v5";

export const runtime = "nodejs";

/**
 * POST /api/v1/diagnostic/runs
 *
 * Public, anonymous-friendly. Creates a Prospectos run with instance_id=NULL
 * and runs the diagnostic synchronously (~5-15s depending on the site).
 * Returns the run_id UUID — that's the share token. Read the report back
 * via GET /api/v1/diagnostic/runs/{run_id} or via the public web page at
 * /diagnostics/{run_id}.
 *
 * Rate-limited per IP via record_diagnostic_request RPC: 5 req/hour,
 * 20 req/day. Limits are enforced atomically inside the SECURITY DEFINER
 * function; this route just calls it and refuses on false.
 *
 * Used by the landing-page diagnostic widget and any third-party caller.
 * The RRE admin UI continues to call the runner directly via server
 * action (startDiagnostic), not through this route.
 *
 * v5 routing: pass "version": "v5" in the request body, or set
 * PROSPECTOS_V5_ENABLED=1 in the environment. When active, runs the v5
 * atomic-rubric stack alongside legacy scoring and extends the response with a
 * "v5" field. The legacy response shape is preserved unchanged (additive only).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

type Body = {
  url?: unknown;
  pdp_url?: unknown;
  category_url?: unknown;
  display_name?: unknown;
  vertical_id?: unknown;
  contact_email?: unknown;
  version?: unknown;
};

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "0.0.0.0";
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function isV5Requested(body: Body): boolean {
  if (process.env.PROSPECTOS_V5_ENABLED === "1") return true;
  return body.version === "v5";
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return json(400, { error: "url_required" });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, {
      error: "diagnostic_not_configured",
      detail:
        "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment — the public diagnostic API is offline.",
    });
  }

  // Rate limit (per-IP sliding window) — always enforced before any scoring.
  const ip = getClientIp(req);
  const service = createServiceRoleClient();
  const { data: allowed, error: rlErr } = await service.rpc(
    "record_diagnostic_request",
    { p_ip: ip },
  );
  if (rlErr) {
    return json(500, { error: "rate_limit_check_failed", detail: rlErr.message });
  }
  if (!allowed) {
    return json(429, { error: "rate_limited", retry_after_seconds: 3600 });
  }

  const verticalId =
    typeof body.vertical_id === "number"
      ? body.vertical_id
      : typeof body.vertical_id === "string"
        ? Number(body.vertical_id) || null
        : null;

  const sharedInput = {
    url,
    pdpUrl: typeof body.pdp_url === "string" ? body.pdp_url : null,
    categoryUrl: typeof body.category_url === "string" ? body.category_url : null,
    prospectName: typeof body.display_name === "string" ? body.display_name : null,
    verticalId,
    contactEmail: typeof body.contact_email === "string" ? body.contact_email : null,
  };

  // Legacy run (always executed — the bridge keeps both paths active).
  const legacyResult = await startAnonymousDiagnostic(sharedInput);
  if ("error" in legacyResult) {
    return json(500, { error: "diagnostic_failed", detail: legacyResult.error });
  }

  const response: Record<string, unknown> = {
    run_id: legacyResult.runId,
    report_url: `/diagnostics/${legacyResult.runId}`,
    status: "completed",
  };

  // v5 run (additive — only when requested or feature-flagged).
  if (isV5Requested(body)) {
    const v5Result = await runV5Diagnostic(
      {
        ...sharedInput,
        instanceId: null,
      },
      { supabase: service },
    );

    if ("ok" in v5Result && v5Result.ok) {
      response.v5 = {
        profile: v5Result.report.profile,
        overall: v5Result.report.overall,
        stages: v5Result.report.stages,
        categories: v5Result.report.categories,
        run_id: v5Result.runId,
      };
    } else if ("error" in v5Result) {
      // v5 error is non-fatal: legacy result is still returned.
      response.v5_error = v5Result.error;
    }
  }

  return json(201, response);
}
