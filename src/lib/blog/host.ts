import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Resolve the current request's hostname → `instance.instance_id` for the
 * public blog surface. Returns `null` when no instance maps to the host
 * (e.g. the RRE admin domain itself, or a preview URL), which the
 * caller interprets as "show all published posts across instances".
 *
 * The lookup is the host header, lowercased + port-stripped. Cached
 * per-request via React's request memoization on `headers()`.
 */
export async function instanceIdForHost(): Promise<number | null> {
  const h = await headers();
  const raw = h.get("host") ?? h.get("x-forwarded-host");
  if (!raw) return null;
  const host = raw.toLowerCase().split(":")[0];

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("instance")
    .select("instance_id")
    .eq("domain", host)
    .maybeSingle();
  return (data?.instance_id as number | undefined) ?? null;
}
