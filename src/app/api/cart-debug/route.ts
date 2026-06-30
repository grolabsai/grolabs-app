/**
 * Cart-timeline debug endpoint (Configuration → Events → Carts). Lists the
 * instance's carts from the cart entity, and — given ?cart=<id> — returns that
 * cart's ordered event deltas + its computed row, so you can step-debug a cart:
 * add → add → remove → … → order closes it. force-dynamic + no-store.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: membership } = await supabase
    .from("instance_member").select("instance_id")
    .eq("user_id", user.id).eq("is_current", true).maybeSingle();
  if (!membership) return NextResponse.json({ error: "no current instance" }, { status: 403 });
  const instanceId: number = membership.instance_id;

  const sb = createServiceRoleClient();
  const cartId = new URL(req.url).searchParams.get("cart");

  if (cartId) {
    const [{ data: cart }, { data: events }] = await Promise.all([
      sb.from("cart")
        .select("cart_id, status, value, item_count, total_quantity, user_id, account_id, order_id, created_at, last_event_at, completed_at")
        .eq("instance_id", instanceId).eq("cart_id", cartId).maybeSingle(),
      sb.from("analytics_event")
        .select("id, created_at, event_type, event_name, object_id, object_name, quantity, placement, value, order_id")
        .eq("instance_id", instanceId).eq("cart_id", cartId)
        .order("created_at", { ascending: true }).limit(500),
    ]);
    return NextResponse.json({ cart: cart ?? null, events: events ?? [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: carts } = await sb.from("cart")
    .select("cart_id, status, value, item_count, total_quantity, account_id, order_id, created_at, last_event_at")
    .eq("instance_id", instanceId)
    .order("last_event_at", { ascending: false })
    .limit(150);
  return NextResponse.json({ carts: carts ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
