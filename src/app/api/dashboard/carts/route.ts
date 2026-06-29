/**
 * Realtime open-cart summary endpoint for the Carts tab. Polled by the client
 * (cart-live.tsx) every few seconds, so it must never cache: force-dynamic +
 * no-store. Resolves the caller's current instance from their session, same as
 * the dashboard pages.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCartLive } from "@/lib/analytics/carts-live";

export const dynamic = "force-dynamic";

export async function GET() {
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

  const data = await getCartLive(membership.instance_id);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
