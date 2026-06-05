import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { InstanceListItem } from "@/components/shell/InstanceSwitcher";

/**
 * Build the instance-switcher list for a user.
 *
 * Non-staff: their own active memberships (unchanged from instance-management.md
 * v1). GroLabs staff (is_grolabs_admin): EVERY instance across all tenants,
 * displayed as "domain — instance" and grouped by domain. Per
 * docs/policy/user-management.md §7 / instance-management.md §12.
 */
export async function loadSwitcherInstances(userId: string): Promise<{
  instances: InstanceListItem[];
  currentInstanceId: number | null;
}> {
  const sb = await createClient();
  const { data: staffData } = await sb.rpc("is_grolabs_admin");
  const isStaff = staffData === true;

  // The user's own current instance (their is_current membership), if any.
  const { data: ownRows } = await sb
    .from("instance_member")
    .select("instance_id, is_current")
    .eq("user_id", userId)
    .eq("is_active", true);
  const own = (ownRows ?? []) as { instance_id: number; is_current: boolean }[];
  const currentInstanceId = own.find((r) => r.is_current)?.instance_id ?? null;

  if (!isStaff) {
    const ids = own.map((r) => r.instance_id);
    if (ids.length === 0) return { instances: [], currentInstanceId };
    const { data: instRows } = await sb
      .from("instance")
      .select("instance_id, name")
      .in("instance_id", ids);
    const nameById = new Map(
      ((instRows ?? []) as { instance_id: number; name: string }[]).map((r) => [
        r.instance_id,
        r.name,
      ]),
    );
    const instances: InstanceListItem[] = own
      .map((r) => ({
        instanceId: r.instance_id,
        name: nameById.get(r.instance_id) ?? "",
        isCurrent: r.is_current,
      }))
      .filter((i) => i.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { instances, currentInstanceId };
  }

  // Staff: every instance joined to its tenant domain. Two queries (robust
  // against the PostgREST embed nulling the tenant relation under service-role,
  // as already worked around in instance.ts).
  const admin = createServiceRoleClient();
  const [{ data: instRows }, { data: tenantRows }] = await Promise.all([
    admin.from("instance").select("instance_id, name, tenant_id").order("name"),
    admin.from("tenant").select("tenant_id, name, domain"),
  ]);
  const tenantById = new Map(
    ((tenantRows ?? []) as { tenant_id: number; name: string | null; domain: string | null }[]).map(
      (t) => [t.tenant_id, { name: t.name ?? "", domain: t.domain }],
    ),
  );

  const instances: InstanceListItem[] = ((instRows ?? []) as {
    instance_id: number;
    name: string | null;
    tenant_id: number;
  }[])
    .map((r) => {
      const tenant = tenantById.get(r.tenant_id);
      const instanceName = r.name ?? "";
      const tenantLabel = tenant?.domain || tenant?.name || "";
      const label = tenantLabel ? `${tenantLabel} — ${instanceName}` : instanceName;
      return {
        instanceId: r.instance_id,
        name: instanceName,
        label,
        isCurrent: r.instance_id === currentInstanceId,
      };
    })
    .filter((i) => i.name.length > 0)
    .sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name));

  return { instances, currentInstanceId };
}
