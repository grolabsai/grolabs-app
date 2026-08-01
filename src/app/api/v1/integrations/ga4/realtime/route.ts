/**
 * GET /api/v1/integrations/ga4/realtime
 *
 * Returns the current active-users count from the GA4 Realtime API for the
 * caller's instance. Used by the live widget on /dashboard/traffic.
 *
 * Always 200 with a typed payload — the UI never blocks on a 4xx/5xx, it
 * just shows "—" when ok=false.
 */

import { NextResponse } from "next/server";
import { currentInstanceId } from "@/lib/instance";
import { getRealtimeActiveUsers } from "@/lib/integrations/ga4/fetchers";

export const runtime = "nodejs";

export async function GET() {
  // Canonical is_current resolver — the old is_active .maybeSingle() lookup
  // errored for multi-instance users and this route reported no_membership.
  const instanceId = await currentInstanceId();
  if (instanceId == null) {
    return NextResponse.json({
      ok: false,
      activeUsers: null,
      error: "no_membership",
    });
  }

  const result = await getRealtimeActiveUsers(instanceId);
  const res = NextResponse.json(result);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
