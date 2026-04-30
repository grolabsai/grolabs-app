"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { FunnelTransitionType } from "@/lib/funnel/types";

export type ActionResult = { ok: true } | { error: string };

/**
 * Shared-table writes (funnel_flow, funnel_stage, funnel_transition,
 * funnel_friction_point) are gated to service_role at the RLS layer.
 * The actions below open a service-role client to perform the write.
 *
 * App-level admin gating is NOT yet wired up — any authenticated user
 * can call these actions. See CLAUDE.md §17 "Known schema debt" for
 * the role-gating follow-up.
 */
async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthenticated" };
  return null;
}

function invalidateFunnel() {
  // Revalidate the entire /funnel subtree — the slug page reads many
  // joined tables and the cheapest path is to bust them all.
  revalidatePath("/funnel", "layout");
}

// ─── funnel_stage ─────────────────────────────────────────────────────────

export type CreateFunnelStageInput = {
  funnel_flow_id: number;
  slug: string;
  label: string;
  stage_order: number | null;
  color: string | null;
  position_x: number;
  position_y: number;
  icon_key: string | null;
  is_terminal: boolean;
  is_dropoff: boolean;
};

export async function createFunnelStage(
  input: CreateFunnelStageInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.slug.trim()) return { error: "Slug is required" };
  if (!input.label.trim()) return { error: "Label is required" };

  const sb = createServiceRoleClient();
  const { error } = await sb.from("funnel_stage").insert({
    funnel_flow_id: input.funnel_flow_id,
    slug: input.slug.trim(),
    label: input.label.trim(),
    stage_order: input.stage_order,
    color: input.color,
    position_x: input.position_x,
    position_y: input.position_y,
    icon_key: input.icon_key,
    is_terminal: input.is_terminal,
    is_dropoff: input.is_dropoff,
  });
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export type UpdateFunnelStageInput = CreateFunnelStageInput & {
  funnel_stage_id: number;
};

export async function updateFunnelStage(
  input: UpdateFunnelStageInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.slug.trim()) return { error: "Slug is required" };
  if (!input.label.trim()) return { error: "Label is required" };

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("funnel_stage")
    .update({
      slug: input.slug.trim(),
      label: input.label.trim(),
      stage_order: input.stage_order,
      color: input.color,
      position_x: input.position_x,
      position_y: input.position_y,
      icon_key: input.icon_key,
      is_terminal: input.is_terminal,
      is_dropoff: input.is_dropoff,
    })
    .eq("funnel_stage_id", input.funnel_stage_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export async function deleteFunnelStage(
  funnel_stage_id: number,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("funnel_stage")
    .delete()
    .eq("funnel_stage_id", funnel_stage_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

// ─── funnel_transition ────────────────────────────────────────────────────

export type CreateFunnelTransitionInput = {
  funnel_flow_id: number;
  source_stage_id: number;
  target_stage_id: number;
  slug: string;
  transition_type: FunnelTransitionType;
  is_active: boolean;
};

export async function createFunnelTransition(
  input: CreateFunnelTransitionInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.slug.trim()) return { error: "Slug is required" };
  if (input.source_stage_id === input.target_stage_id) {
    return { error: "Source and target must differ" };
  }

  const sb = createServiceRoleClient();
  const { error } = await sb.from("funnel_transition").insert({
    funnel_flow_id: input.funnel_flow_id,
    source_stage_id: input.source_stage_id,
    target_stage_id: input.target_stage_id,
    slug: input.slug.trim(),
    transition_type: input.transition_type,
    is_active: input.is_active,
  });
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export type UpdateFunnelTransitionInput = CreateFunnelTransitionInput & {
  funnel_transition_id: number;
};

export async function updateFunnelTransition(
  input: UpdateFunnelTransitionInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.slug.trim()) return { error: "Slug is required" };
  if (input.source_stage_id === input.target_stage_id) {
    return { error: "Source and target must differ" };
  }

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("funnel_transition")
    .update({
      source_stage_id: input.source_stage_id,
      target_stage_id: input.target_stage_id,
      slug: input.slug.trim(),
      transition_type: input.transition_type,
      is_active: input.is_active,
    })
    .eq("funnel_transition_id", input.funnel_transition_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export async function deleteFunnelTransition(
  funnel_transition_id: number,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("funnel_transition")
    .delete()
    .eq("funnel_transition_id", funnel_transition_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}
