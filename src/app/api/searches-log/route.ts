/**
 * Raw search log for the current instance — the query_log half of the Events
 * viewer (the analytics_event half is /api/events-log). "Search Performed" lives
 * in query_log, not analytics_event, so the viewer needs both to cover the full
 * backend. Read-only, newest-first, polled by the client. force-dynamic + no-store.
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
    .from("query_log")
    .select(
      "id, created_at, query, total_hits, is_committed, commit_reason, user_id, account_id, query_uid, intent_group_id, origin",
    )
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[searches-log] read failed:", error.message);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { instanceId, count: data?.length ?? 0, searches: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
