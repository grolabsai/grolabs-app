"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveSlug } from "@/lib/instanceSlug";
import { ensureIndex } from "@/lib/search/meilisearch-client";

/**
 * Server actions for multi-instance membership management.
 *
 * Per docs/policy/instance-management.md.
 */

export type SwitchResult =
  | { ok: true; instanceId: number }
  | { ok: false; error: "unauthorized" | "not_a_member" | "save_failed"; message?: string };

export type CreateResult =
  | { ok: true; instanceId: number; slug: string }
  | { ok: false; error: "unauthorized" | "invalid_name" | "save_failed"; message?: string };

const NAME_MAX_LEN = 80;

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

/**
 * Create a new instance. The caller becomes its owner and immediately switches
 * into it (is_current cleared on their other memberships, set on the new one).
 *
 * v1 starts the instance empty: no template seeding, defaults from the schema
 * (kind='customer', es-GT, GTQ, etc.). Per policy §10, template seeding is a
 * separate future feature.
 *
 * Slug uses deriveSlug; on collision a numeric suffix is appended (`-2`, `-3`).
 *
 * Caller should `router.refresh()` after success.
 */
export async function createInstance(name: string): Promise<CreateResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX_LEN) {
    return { ok: false, error: "invalid_name" };
  }
  const baseSlug = deriveSlug(trimmed);
  if (baseSlug.length === 0) {
    return { ok: false, error: "invalid_name" };
  }

  const admin = createServiceRoleClient();

  // Resolve a unique slug. Pull every slug that starts with baseSlug and pick
  // the lowest free suffix. One round-trip; race losers retry inside the insert.
  const { data: collisions, error: collisionErr } = await admin
    .from("instance")
    .select("slug")
    .like("slug", `${baseSlug}%`);
  if (collisionErr) {
    return { ok: false, error: "save_failed", message: collisionErr.message };
  }
  const taken = new Set((collisions ?? []).map((r) => r.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  // Resolve the tenant this instance will belong to. instance.tenant_id is
  // NOT NULL (20260513000001) and instance_member inserts require an active
  // tenant_member row for (tenant, user) (trigger from 20260514000001).
  //
  // Policy: a new instance joins the user's existing tenant. If the user has
  // no tenant_member yet, create a customer tenant and make them its owner.
  const { data: existingMemberships, error: tmLookupErr } = await admin
    .from("tenant_member")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (tmLookupErr) {
    return { ok: false, error: "save_failed", message: tmLookupErr.message };
  }

  let tenantId: number;
  const ownerMembership = (existingMemberships ?? []).find(
    (m) => m.role === "owner",
  );
  const anyMembership = (existingMemberships ?? [])[0];
  const reuse = ownerMembership ?? anyMembership;

  if (reuse) {
    tenantId = reuse.tenant_id as number;
  } else {
    // No tenant yet — create one for this user and make them its owner.
    const tenantName = user.email ? user.email.split("@")[0] : trimmed;
    const tenantBaseSlug = deriveSlug(tenantName) || deriveSlug(trimmed) || "tenant";

    const { data: tenantSlugRows, error: tenantSlugErr } = await admin
      .from("tenant")
      .select("slug")
      .like("slug", `${tenantBaseSlug}%`);
    if (tenantSlugErr) {
      return { ok: false, error: "save_failed", message: tenantSlugErr.message };
    }
    const tenantTaken = new Set((tenantSlugRows ?? []).map((r) => r.slug));
    let tenantSlug = tenantBaseSlug;
    let tenantSuffix = 2;
    while (tenantTaken.has(tenantSlug)) {
      tenantSlug = `${tenantBaseSlug}-${tenantSuffix}`;
      tenantSuffix += 1;
    }

    const { data: newTenant, error: tenantInsertErr } = await admin
      .from("tenant")
      .insert({ name: tenantName, slug: tenantSlug, kind: "customer" })
      .select("tenant_id")
      .single();
    if (tenantInsertErr || !newTenant) {
      return {
        ok: false,
        error: "save_failed",
        message: tenantInsertErr?.message ?? "tenant insert returned no row",
      };
    }
    tenantId = newTenant.tenant_id as number;

    const { error: tmInsertErr } = await admin.from("tenant_member").insert({
      tenant_id: tenantId,
      user_id: user.id,
      role: "owner",
      is_active: true,
    });
    if (tmInsertErr) {
      return { ok: false, error: "save_failed", message: tmInsertErr.message };
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from("instance")
    .insert({ name: trimmed, slug, kind: "customer", tenant_id: tenantId })
    .select("instance_id")
    .single();
  if (insertErr || !inserted) {
    return {
      ok: false,
      error: "save_failed",
      message: insertErr?.message ?? "insert returned no row",
    };
  }
  const newInstanceId = inserted.instance_id as number;

  // Clear is_current on every other membership the user has, so the partial
  // unique index doesn't reject the membership insert below.
  const { error: clearErr } = await admin
    .from("instance_member")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (clearErr) {
    return { ok: false, error: "save_failed", message: clearErr.message };
  }

  const { error: memberErr } = await admin.from("instance_member").insert({
    instance_id: newInstanceId,
    user_id: user.id,
    role: "owner",
    is_active: true,
    is_current: true,
  });
  if (memberErr) {
    return { ok: false, error: "save_failed", message: memberErr.message };
  }

  // Eagerly provision the MeiliSearch index so search works immediately for
  // test instances. Best-effort: a MeiliSearch outage must not fail instance
  // creation — the index is lazily (re)created on first product sync anyway.
  try {
    await ensureIndex(newInstanceId);
  } catch (err) {
    console.warn(
      `[createInstance] ensureIndex(${newInstanceId}) failed; index will be created lazily on first sync:`,
      err,
    );
  }

  revalidatePath("/", "layout");
  return { ok: true, instanceId: newInstanceId, slug };
}
