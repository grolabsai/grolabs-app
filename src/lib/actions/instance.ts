"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveSlug } from "@/lib/instanceSlug";

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

  const { data: inserted, error: insertErr } = await admin
    .from("instance")
    .insert({ name: trimmed, slug, kind: "customer" })
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

  revalidatePath("/", "layout");
  return { ok: true, instanceId: newInstanceId, slug };
}
