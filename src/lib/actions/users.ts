"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { currentTenantId } from "@/lib/auth/roles";
import { deriveSlug } from "@/lib/instanceSlug";

/**
 * Server actions for admin-provisioned user & account management.
 *
 * Two entry points, both service-role and both re-checking authorization
 * server-side:
 *   - createCustomerAccount — GroLabs staff create a customer (tenant + domain
 *     + first instance + first Tenant Admin). Gated by is_grolabs_admin().
 *   - createTenantUser / setTenantUserRole / deactivateTenantUser — a Tenant
 *     Admin manages users for their own tenant. Gated by is_tenant_admin().
 *
 * Per docs/policy/user-management.md §3, §4. Article 3: tenant identity = domain
 * (resolve-or-create by domain); email is globally unique (resolve-or-attach an
 * existing user — the collaborator primitive).
 */

type AdminClient = ReturnType<typeof createServiceRoleClient>;

export type TenantRole = "admin" | "member";

export type CreateCustomerResult =
  | {
      ok: true;
      tenantId: number;
      instanceId: number;
      userId: string;
      reusedTenant: boolean;
      reusedUser: boolean;
      // The one-time password, returned only when a NEW auth user was created.
      password?: string;
    }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "invalid_domain"
        | "invalid_email"
        | "invalid_name"
        | "save_failed";
      message?: string;
    };

export type CreateTenantUserResult =
  | { ok: true; userId: string; reusedUser: boolean; password?: string }
  | {
      ok: false;
      error: "unauthorized" | "invalid_email" | "invalid_role" | "save_failed";
      message?: string;
    };

export type MutateMemberResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid_role" | "save_failed"; message?: string };

export type TenantSummary = {
  tenantId: number;
  name: string;
  domain: string | null;
  instanceCount: number;
  memberCount: number;
};

export type TenantMemberSummary = {
  userId: string;
  email: string;
  role: string;
  isActive: boolean;
};

const NAME_MAX_LEN = 80;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Resolve a unique slug for `table` from a base, appending -2, -3, … on
 * collision. Mirrors createInstance's approach.
 */
async function uniqueSlug(
  admin: AdminClient,
  table: "tenant" | "instance",
  base: string,
): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  const { data, error } = await admin.from(table).select("slug").like("slug", `${base}%`);
  if (error) return { ok: false, message: error.message };
  const taken = new Set((data ?? []).map((r) => (r as { slug: string }).slug));
  let slug = base;
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return { ok: true, slug };
}

/**
 * Resolve an existing auth user by email, or create one with a generated
 * password + must_change_password. Allow-lists the email first so the
 * Before-User-Created hook (when enabled) permits the creation.
 *
 * Returns the user id, whether it was reused, and the password to surface
 * (only when newly created).
 */
async function resolveOrCreateUser(
  admin: AdminClient,
  email: string,
  password: string,
): Promise<
  | { ok: true; userId: string; reusedUser: boolean; password?: string }
  | { ok: false; message: string }
> {
  const { data: existingId, error: lookupErr } = await admin.rpc(
    "get_auth_user_id_by_email",
    { p_email: email },
  );
  if (lookupErr) return { ok: false, message: lookupErr.message };
  if (existingId) {
    return { ok: true, userId: existingId as string, reusedUser: true };
  }

  // Provision: allow-list, then create with a forced first-login change.
  const { error: allowErr } = await admin
    .from("signup_allowlist")
    .upsert({ email }, { onConflict: "email" });
  if (allowErr) {
    console.warn("[resolveOrCreateUser] allowlist upsert failed:", allowErr.message);
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });
  if (createErr || !created?.user) {
    return { ok: false, message: createErr?.message ?? "createUser returned no user" };
  }
  return { ok: true, userId: created.user.id, reusedUser: false, password };
}

/**
 * Ensure a tenant_member row (admin/member) exists for (tenant, user). Inserts
 * if absent, updates role + reactivates if present. tenant_member must exist
 * BEFORE any instance_member (tenant-membership.md trigger contract).
 */
async function ensureTenantMember(
  admin: AdminClient,
  tenantId: number,
  userId: string,
  role: TenantRole | "owner",
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existing, error: selErr } = await admin
    .from("tenant_member")
    .select("tenant_member_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) return { ok: false, message: selErr.message };

  if (existing) {
    const { error } = await admin
      .from("tenant_member")
      .update({ role, is_active: true, updated_at: new Date().toISOString() })
      .eq("tenant_member_id", (existing as { tenant_member_id: number }).tenant_member_id);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  const { error } = await admin
    .from("tenant_member")
    .insert({ tenant_id: tenantId, user_id: userId, role, is_active: true });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Ensure an instance_member row for (instance, user). Inserts if absent,
 * reactivates if present. `setCurrent` flips is_current for this user (only
 * for brand-new accounts — never disturbs an existing user's current view).
 */
async function ensureInstanceMember(
  admin: AdminClient,
  instanceId: number,
  userId: string,
  role: string,
  setCurrent: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (setCurrent) {
    const { error: clearErr } = await admin
      .from("instance_member")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (clearErr) return { ok: false, message: clearErr.message };
  }

  const { data: existing, error: selErr } = await admin
    .from("instance_member")
    .select("member_id")
    .eq("instance_id", instanceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) return { ok: false, message: selErr.message };

  if (existing) {
    const { error } = await admin
      .from("instance_member")
      .update({
        is_active: true,
        ...(setCurrent ? { is_current: true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("member_id", (existing as { member_id: number }).member_id);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  const { error } = await admin.from("instance_member").insert({
    instance_id: instanceId,
    user_id: userId,
    role,
    is_active: true,
    is_current: setCurrent,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PR4 — admin "Clientes": create a customer (GroLabs staff only)
// ---------------------------------------------------------------------------

export async function createCustomerAccount(input: {
  domain: string;
  tenantName: string;
  instanceName: string;
  email: string;
  password: string;
}): Promise<CreateCustomerResult> {
  const sb = await createClient();
  const { data: isAdmin, error: gateErr } = await sb.rpc("is_grolabs_admin");
  if (gateErr || isAdmin !== true) return { ok: false, error: "unauthorized" };

  const domain = input.domain.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const tenantName = input.tenantName.trim();
  const instanceName = input.instanceName.trim();

  if (!DOMAIN_RE.test(domain)) return { ok: false, error: "invalid_domain" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };
  if (instanceName.length === 0 || instanceName.length > NAME_MAX_LEN) {
    return { ok: false, error: "invalid_name" };
  }

  const admin = createServiceRoleClient();

  // 1. Resolve-or-create the tenant by domain (Article 3 — same domain joins
  //    the existing tenant; never duplicate).
  let tenantId: number;
  let reusedTenant = false;
  const { data: existingTenant, error: tenantLookupErr } = await admin
    .from("tenant")
    .select("tenant_id")
    .eq("domain", domain)
    .maybeSingle();
  if (tenantLookupErr) {
    return { ok: false, error: "save_failed", message: tenantLookupErr.message };
  }
  if (existingTenant) {
    tenantId = (existingTenant as { tenant_id: number }).tenant_id;
    reusedTenant = true;
  } else {
    const effectiveName = tenantName || domain;
    const base = deriveSlug(effectiveName) || deriveSlug(domain) || "tenant";
    const slugRes = await uniqueSlug(admin, "tenant", base);
    if (!slugRes.ok) return { ok: false, error: "save_failed", message: slugRes.message };
    const { data: newTenant, error: insErr } = await admin
      .from("tenant")
      .insert({ name: effectiveName, slug: slugRes.slug, kind: "customer", domain })
      .select("tenant_id")
      .single();
    if (insErr || !newTenant) {
      return { ok: false, error: "save_failed", message: insErr?.message ?? "tenant insert failed" };
    }
    tenantId = (newTenant as { tenant_id: number }).tenant_id;
  }

  // 2. Create the first instance under the tenant.
  const instBase = deriveSlug(instanceName) || "instance";
  const instSlug = await uniqueSlug(admin, "instance", instBase);
  if (!instSlug.ok) return { ok: false, error: "save_failed", message: instSlug.message };
  const { data: newInstance, error: instErr } = await admin
    .from("instance")
    .insert({ name: instanceName, slug: instSlug.slug, kind: "customer", tenant_id: tenantId })
    .select("instance_id")
    .single();
  if (instErr || !newInstance) {
    return { ok: false, error: "save_failed", message: instErr?.message ?? "instance insert failed" };
  }
  const instanceId = (newInstance as { instance_id: number }).instance_id;

  // 3. Resolve-or-create the first user as Tenant Admin.
  const userRes = await resolveOrCreateUser(admin, email, input.password);
  if (!userRes.ok) return { ok: false, error: "save_failed", message: userRes.message };

  // 4. tenant_member (admin) FIRST, then instance_member.
  const tm = await ensureTenantMember(admin, tenantId, userRes.userId, "admin");
  if (!tm.ok) return { ok: false, error: "save_failed", message: tm.message };
  const im = await ensureInstanceMember(
    admin,
    instanceId,
    userRes.userId,
    "owner",
    !userRes.reusedUser, // only set is_current for a brand-new account
  );
  if (!im.ok) return { ok: false, error: "save_failed", message: im.message };

  revalidatePath("/", "layout");
  return {
    ok: true,
    tenantId,
    instanceId,
    userId: userRes.userId,
    reusedTenant,
    reusedUser: userRes.reusedUser,
    password: userRes.password,
  };
}

/**
 * List every tenant with instance + member counts, for the admin Clientes
 * screen. GroLabs staff only.
 */
export async function listTenantsForAdmin(): Promise<
  { ok: true; tenants: TenantSummary[] } | { ok: false; error: string }
> {
  const sb = await createClient();
  const { data: isAdmin, error: gateErr } = await sb.rpc("is_grolabs_admin");
  if (gateErr || isAdmin !== true) return { ok: false, error: "unauthorized" };

  const admin = createServiceRoleClient();
  const { data: tenants, error: tErr } = await admin
    .from("tenant")
    .select("tenant_id, name, domain")
    .order("tenant_id");
  if (tErr) return { ok: false, error: tErr.message };

  const { data: instRows } = await admin.from("instance").select("tenant_id");
  const { data: memberRows } = await admin.from("tenant_member").select("tenant_id, is_active");

  const instByTenant = new Map<number, number>();
  for (const r of (instRows ?? []) as { tenant_id: number }[]) {
    instByTenant.set(r.tenant_id, (instByTenant.get(r.tenant_id) ?? 0) + 1);
  }
  const memberByTenant = new Map<number, number>();
  for (const r of (memberRows ?? []) as { tenant_id: number; is_active: boolean }[]) {
    if (r.is_active) memberByTenant.set(r.tenant_id, (memberByTenant.get(r.tenant_id) ?? 0) + 1);
  }

  const out: TenantSummary[] = ((tenants ?? []) as {
    tenant_id: number;
    name: string | null;
    domain: string | null;
  }[]).map((t) => ({
    tenantId: t.tenant_id,
    name: t.name ?? "",
    domain: t.domain,
    instanceCount: instByTenant.get(t.tenant_id) ?? 0,
    memberCount: memberByTenant.get(t.tenant_id) ?? 0,
  }));
  return { ok: true, tenants: out };
}

// ---------------------------------------------------------------------------
// PR5 — RRE "Equipo": Tenant Admin manages their own users
// ---------------------------------------------------------------------------

async function gateTenantAdmin(): Promise<
  { ok: true; tenantId: number } | { ok: false }
> {
  const tenantId = await currentTenantId();
  if (tenantId === null) return { ok: false };
  const sb = await createClient();
  const { data, error } = await sb.rpc("is_tenant_admin", { p_tenant_id: tenantId });
  if (error || data !== true) return { ok: false };
  return { ok: true, tenantId };
}

export async function createTenantUser(
  email: string,
  role: TenantRole,
  password: string,
): Promise<CreateTenantUserResult> {
  const gate = await gateTenantAdmin();
  if (!gate.ok) return { ok: false, error: "unauthorized" };
  if (role !== "admin" && role !== "member") return { ok: false, error: "invalid_role" };

  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) return { ok: false, error: "invalid_email" };

  const admin = createServiceRoleClient();
  const userRes = await resolveOrCreateUser(admin, normalizedEmail, password);
  if (!userRes.ok) return { ok: false, error: "save_failed", message: userRes.message };

  const tm = await ensureTenantMember(admin, gate.tenantId, userRes.userId, role);
  if (!tm.ok) return { ok: false, error: "save_failed", message: tm.message };

  // Grant access to ALL of the tenant's instances (R-5: tenant-wide).
  const { data: instances, error: instErr } = await admin
    .from("instance")
    .select("instance_id")
    .eq("tenant_id", gate.tenantId);
  if (instErr) return { ok: false, error: "save_failed", message: instErr.message };

  const instanceRole = role === "admin" ? "admin" : "member";
  for (const row of (instances ?? []) as { instance_id: number }[]) {
    const im = await ensureInstanceMember(
      admin,
      row.instance_id,
      userRes.userId,
      instanceRole,
      false, // never flip a freshly-added member's current instance
    );
    if (!im.ok) return { ok: false, error: "save_failed", message: im.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, userId: userRes.userId, reusedUser: userRes.reusedUser, password: userRes.password };
}

export async function setTenantUserRole(
  userId: string,
  role: TenantRole,
): Promise<MutateMemberResult> {
  const gate = await gateTenantAdmin();
  if (!gate.ok) return { ok: false, error: "unauthorized" };
  if (role !== "admin" && role !== "member") return { ok: false, error: "invalid_role" };

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("tenant_member")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "save_failed", message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deactivateTenantUser(userId: string): Promise<MutateMemberResult> {
  const gate = await gateTenantAdmin();
  if (!gate.ok) return { ok: false, error: "unauthorized" };

  const admin = createServiceRoleClient();
  const { error: tmErr } = await admin
    .from("tenant_member")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId)
    .eq("user_id", userId);
  if (tmErr) return { ok: false, error: "save_failed", message: tmErr.message };

  // Also deactivate the user's memberships on this tenant's instances.
  const { data: instances } = await admin
    .from("instance")
    .select("instance_id")
    .eq("tenant_id", gate.tenantId);
  const ids = ((instances ?? []) as { instance_id: number }[]).map((r) => r.instance_id);
  if (ids.length > 0) {
    await admin
      .from("instance_member")
      .update({ is_active: false, is_current: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("instance_id", ids);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * List the caller's tenant members (email, role, active) for the Equipo screen.
 * Tenant Admins only. Emails are resolved via the admin API and exposed only
 * for members of the caller's own tenant.
 */
export async function listTenantMembers(): Promise<
  { ok: true; members: TenantMemberSummary[] } | { ok: false; error: string }
> {
  const gate = await gateTenantAdmin();
  if (!gate.ok) return { ok: false, error: "unauthorized" };

  const admin = createServiceRoleClient();
  const { data: rows, error } = await admin
    .from("tenant_member")
    .select("user_id, role, is_active")
    .eq("tenant_id", gate.tenantId);
  if (error) return { ok: false, error: error.message };

  const members = (rows ?? []) as { user_id: string; role: string; is_active: boolean }[];
  const emailById = new Map<string, string>();
  // Resolve emails for just this tenant's members.
  await Promise.all(
    members.map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data?.user?.email) emailById.set(m.user_id, data.user.email);
    }),
  );

  const out: TenantMemberSummary[] = members
    .map((m) => ({
      userId: m.user_id,
      email: emailById.get(m.user_id) ?? "",
      role: m.role,
      isActive: m.is_active,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  return { ok: true, members: out };
}
