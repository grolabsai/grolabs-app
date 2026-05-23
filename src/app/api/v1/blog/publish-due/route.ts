import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/**
 * Vercel cron job — runs every 5 minutes (see vercel.json). Flips every
 * `status='scheduled'` post whose `published_at` has arrived to
 * `status='published'`. Vercel injects an `Authorization: Bearer <CRON_SECRET>`
 * header for cron-triggered invocations; we reject anything else so the
 * route can't be hit publicly to force-publish drafts.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("publish_due_posts");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ published: data ?? 0 });
}
