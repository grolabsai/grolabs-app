/**
 * Raw events log for the current instance — powers the configuration/events
 * viewer. Read-only, newest-first, polled by the client so you can watch events
 * land live while testing the WordPress plugin. force-dynamic + no-store.
 *
 * Resolves the caller's current instance from their session (same as the other
 * dashboard endpoints), then reads analytics_event with the service-role client
 * scoped to that instance_id — a debug surface that shows exactly what was
 * recorded, every column.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "no current instance" }, { status: 403 });
  }
  const instanceId: number = membership.instance_id;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("analytics_event")
    .select(
      "id, created_at, event_type, event_name, placement, user_id, account_id, object_id, object_name, position, cart_id, order_id, value, quantity, query_uid, origin",
    )
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[events-log] read failed:", error.message);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { instanceId, count: data?.length ?? 0, events: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
