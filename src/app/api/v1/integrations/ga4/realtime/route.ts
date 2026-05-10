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
import { createClient } from "@/lib/supabase/server";
import { getRealtimeActiveUsers } from "@/lib/integrations/ga4/fetchers";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, activeUsers: null, error: "unauth" });
  }
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({
      ok: false,
      activeUsers: null,
      error: "no_membership",
    });
  }

  const result = await getRealtimeActiveUsers(membership.instance_id);
  const res = NextResponse.json(result);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
