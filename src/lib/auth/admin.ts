import { createClient } from "@/lib/supabase/server";

/**
 * Authorization checkpoint for the GroLabs admin surface (admin.grolabs.ai,
 * the `(admin)` route group).
 *
 * REAL CHECK (docs/policy/user-management.md §8): true iff the current auth
 * user is an active `tenant_member` of the GroLabs template-owner tenant (the
 * tenant that owns instance 0). This replaces the Phase-1 default-granted stub
 * and CLOSES SEC-001 — a non-GroLabs authenticated user reaching an admin URL
 * now gets `notFound()` from the (admin) layout.
 *
 * Backed by the SQL mirror `public.is_grolabs_admin()` (SECURITY DEFINER), so
 * RLS/RPCs can reuse the same predicate. Reads auth.uid() server-side, so it
 * needs no `user` argument.
 */
export async function isGroLabsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_grolabs_admin");
  if (error) {
    console.error("[isGroLabsAdmin] is_grolabs_admin RPC failed:", error);
    return false;
  }
  return data === true;
}
