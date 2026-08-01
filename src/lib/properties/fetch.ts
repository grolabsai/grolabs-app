/**
 * Tenant + instance properties for /configuration/properties.
 *
 * Read-only view of what the database actually holds, so the tenant/instance
 * configuration can be inspected in one place rather than inferred from
 * scattered screens.
 *
 * Everything here goes through the normal authenticated client — RLS decides
 * what is visible:
 *   - `tenant`   → tenant_select_for_members (SELECT only; there is no UPDATE
 *                  policy, which is why the tenant panel is read-only)
 *   - `instance` → tenant_self_select for reads, tenant_self_update for writes
 *                  (owner/admin members only)
 * No service-role anywhere: this screen must show exactly what the signed-in
 * user is actually allowed to see.
 */

import { createClient } from "@/lib/supabase/server";

export interface TenantProperties {
  tenant_id: number;
  name: string;
  slug: string;
  kind: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstanceProperties {
  instance_id: number;
  tenant_id: number;
  name: string;
  slug: string;
  kind: string;
  domain: string | null;
  plan: string;
  is_active: boolean;
  primary_locale: string;
  supported_locales: string[];
  default_currency: string;
  timezone: string;
  storefront_domains: string[];
  last_search_sync_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Names of the configured integration keys only — never their values.
   * integrations_config can hold API keys, so the screen shows *that* an
   * integration is configured, not what it is configured with.
   */
  configured_integrations: string[];
}

export interface PropertiesView {
  tenant: TenantProperties | null;
  instances: InstanceProperties[];
  currentInstanceId: number | null;
  /** True when the signed-in user may edit instance rows (owner/admin). */
  canEditInstances: boolean;
}

export async function getPropertiesView(): Promise<PropertiesView> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      tenant: null,
      instances: [],
      currentInstanceId: null,
      canEditInstances: false,
    };
  }

  // Memberships decide both which instance is current and whether this user
  // can edit — the same owner/admin test the RLS UPDATE policy applies.
  const { data: memberships } = await supabase
    .from("instance_member")
    .select("instance_id, role, is_current")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const rows = (memberships ?? []) as {
    instance_id: number;
    role: string;
    is_current: boolean;
  }[];
  const currentInstanceId =
    rows.find((r) => r.is_current)?.instance_id ??
    (rows.length > 0
      ? rows.map((r) => r.instance_id).sort((a, b) => a - b)[0]
      : null);
  const canEditInstances = rows.some(
    (r) => r.role === "owner" || r.role === "admin",
  );

  if (currentInstanceId == null) {
    return { tenant: null, instances: [], currentInstanceId: null, canEditInstances };
  }

  // Resolve the tenant via the CURRENT instance, then list every instance of
  // that tenant — the one-to-many the screen is built around.
  const { data: currentRow } = await supabase
    .from("instance")
    .select("tenant_id")
    .eq("instance_id", currentInstanceId)
    .maybeSingle();
  const tenantId = (currentRow?.tenant_id as number | undefined) ?? null;
  if (tenantId == null) {
    return { tenant: null, instances: [], currentInstanceId, canEditInstances };
  }

  const { data: tenantRow } = await supabase
    .from("tenant")
    .select("tenant_id, name, slug, kind, domain, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { data: instanceRows } = await supabase
    .from("instance")
    .select(
      "instance_id, tenant_id, name, slug, kind, domain, plan, is_active, primary_locale, supported_locales, default_currency, timezone, storefront_domains, last_search_sync_at, created_at, updated_at, integrations_config",
    )
    .eq("tenant_id", tenantId)
    .order("instance_id");

  const instances: InstanceProperties[] = (instanceRows ?? []).map((r) => {
    const cfg = (r.integrations_config ?? {}) as Record<string, unknown>;
    return {
      instance_id: r.instance_id as number,
      tenant_id: r.tenant_id as number,
      name: (r.name as string) ?? "",
      slug: (r.slug as string) ?? "",
      kind: (r.kind as string) ?? "",
      domain: (r.domain as string | null) ?? null,
      plan: (r.plan as string) ?? "",
      is_active: Boolean(r.is_active),
      primary_locale: (r.primary_locale as string) ?? "",
      supported_locales: (r.supported_locales as string[]) ?? [],
      default_currency: (r.default_currency as string) ?? "",
      timezone: (r.timezone as string) ?? "",
      storefront_domains: (r.storefront_domains as string[]) ?? [],
      last_search_sync_at: (r.last_search_sync_at as string | null) ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      configured_integrations: Object.keys(cfg).sort(),
    };
  });

  return {
    tenant: (tenantRow as TenantProperties | null) ?? null,
    instances,
    currentInstanceId,
    canEditInstances,
  };
}
