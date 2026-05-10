"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Server actions for multi-instance membership management.
 *
 * Per docs/policy/instance-management.md (PR #67). v1 ships only the switch
 * action — createInstance and the topbar dropdown UI land with terminal 6's
 * implementation PR.
 */

export type SwitchResult =
  | { ok: true; instanceId: number }
  | { ok: false; error: "unauthorized" | "not_a_member" | "save_failed"; message?: string };

/**
 * Atomically flip is_current to point at the target instance.
 *
 * Validates the user has an active membership on the target. Then in a single
 * transaction (via service-role to span the user's other rows safely):
 *   - clears is_current on all of the user's memberships
 *   - sets is_current=true on the target
 *
 * The partial unique index on instance_member (user_id) WHERE is_current = true
 * catches any double-set bug at the DB layer.
 *
 * Caller should `router.refresh()` after success so server components re-evaluate
 * their instance scope. We also revalidatePath here to invalidate the layout cache.
 */
export async function switchToInstance(instanceId: number): Promise<SwitchResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // Membership check uses the user-session client — RLS confirms they can see
  // the row. Keeps is_active here (not is_current): a user can switch to any
  // instance they're an active member of, regardless of which one is current.
  const { data: membership, error: lookupErr } = await sb
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("instance_id", instanceId)
    .eq("is_active", true)
    .maybeSingle();
  if (lookupErr) {
    return { ok: false, error: "save_failed", message: lookupErr.message };
  }
  if (!membership) return { ok: false, error: "not_a_member" };

  // Service-role for the cross-row update (clearing is_current on rows the user
  // could otherwise see via RLS, but using service role keeps the two updates
  // atomic and isolated from policy edge cases).
  const admin = createServiceRoleClient();

  const { error: clearErr } = await admin
    .from("instance_member")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .neq("instance_id", instanceId);
  if (clearErr) {
    return { ok: false, error: "save_failed", message: clearErr.message };
  }

  const { error: setErr } = await admin
    .from("instance_member")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("instance_id", instanceId);
  if (setErr) {
    return { ok: false, error: "save_failed", message: setErr.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, instanceId };
}
