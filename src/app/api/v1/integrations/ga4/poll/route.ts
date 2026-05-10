/**
 * GET /api/v1/integrations/ga4/poll
 *
 * Vercel Cron entrypoint. Iterates every instance with active GA4 credentials,
 * pulls the trailing N days, then runs anomaly detection.
 *
 * Authorization: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron
 * automatically attaches this when the route is configured in vercel.json.
 *
 * Returns a JSON summary; 200 with `ok: false` per-instance entries if any
 * pulls failed (the run as a whole still succeeds — failures are isolated).
 */

import { NextRequest, NextResponse } from "next/server";
import { pullAllInstances } from "@/lib/integrations/ga4/poll";
import { runAnomalyDetectionForAll } from "@/lib/integrations/ga4/anomaly";

export const runtime = "nodejs";
// Vercel function timeout — polling all instances may take a while.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const pulls = await pullAllInstances();
  const anomalies = await runAnomalyDetectionForAll();
  const elapsedMs = Date.now() - start;

  return NextResponse.json({
    ok: true,
    elapsedMs,
    pulls,
    anomalies,
  });
}
