import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";

/**
 * Tenant-role helpers for the user-management surfaces.
 *
 * The source of truth for "who can manage users" is tenant_member.role
 * (admin | member). These resolve the current user's tenant (via their
 * current instance) and whether they administer it. Per
 * docs/policy/user-management.md §2.2 and tenant-membership.md §2.
 */

/**
 * The tenant_id of the user's currently-active instance, or null when the user
 * has no current instance (unauthenticated / no membership).
 */
export async function currentTenantId(): Promise<number | null> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instance")
    .select("tenant_id")
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (error || !data) return null;
  const tenantId = (data as { tenant_id: number | null }).tenant_id;
  return tenantId ?? null;
}

/**
 * True when the current user administers their current tenant (tenant_member
 * role owner | admin). Backed by the is_tenant_admin(p_tenant_id) SQL helper.
 */
export async function isCurrentTenantAdmin(): Promise<boolean> {
  const tenantId = await currentTenantId();
  if (tenantId === null) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_tenant_admin", {
    p_tenant_id: tenantId,
  });
  if (error) {
    console.error("[isCurrentTenantAdmin] is_tenant_admin RPC failed:", error);
    return false;
  }
  return data === true;
}
