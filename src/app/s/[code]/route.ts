import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short URL redirect — `/s/[code]` → 302 to target_url.
 * Host-scoped: looks up the instance via `instance.domain`, falls
 * back to instance 0. Increments click_count atomically server-side
 * via the SECURITY DEFINER `short_link_record_click()` function.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!code || code.length > 16) {
    return new NextResponse("Not found", { status: 404 });
  }

  const host = req.headers.get("host")?.toLowerCase().split(":")[0];
  const supabase = createServiceRoleClient();

  let instanceId: number | null = null;
  if (host) {
    const { data: instanceRow } = await supabase
      .from("instance")
      .select("instance_id")
      .eq("domain", host)
      .maybeSingle();
    instanceId =
      (instanceRow?.instance_id as number | undefined) ?? null;
  }
  // Fallback: instance 0 (template) so previews of the RRE admin URL
  // still work for testing.
  if (instanceId === null) instanceId = 0;

  const { data: target, error } = await supabase.rpc(
    "short_link_record_click",
    { p_instance_id: instanceId, p_code: code },
  );

  if (error || !target) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(target as string, 302);
}
