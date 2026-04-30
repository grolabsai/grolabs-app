"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  FunnelSeverity,
  FunnelSourceType,
  FunnelTransitionType,
} from "@/lib/funnel/types";

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

// ─── funnel_dataset_transition_value (per-tenant) ────────────────────────
//
// Per-tenant tables write through the regular RLS-aware client so the
// instance_member policy authorises the call. The denormalised
// instance_id column is set by the BEFORE-INSERT trigger, NOT passed
// from app code (per CLAUDE.md schema conventions).

export type UpsertDatasetTransitionValueInput = {
  funnel_dataset_id: number;
  funnel_transition_id: number;
  conversion_pct: number;
  source_type: FunnelSourceType;
  notes: string | null;
};

export async function upsertDatasetTransitionValue(
  input: UpsertDatasetTransitionValueInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (input.conversion_pct < 0 || input.conversion_pct > 100) {
    return { error: "conversion_pct must be between 0 and 100" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("funnel_dataset_transition_value")
    .upsert(
      {
        funnel_dataset_id: input.funnel_dataset_id,
        funnel_transition_id: input.funnel_transition_id,
        conversion_pct: input.conversion_pct,
        source_type: input.source_type,
        notes: input.notes,
      },
      { onConflict: "funnel_dataset_id,funnel_transition_id" },
    );
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

// ─── funnel_benchmark_source (per-tenant) ────────────────────────────────

export type CreateBenchmarkSourceInput = {
  funnel_dataset_transition_value_id: number;
  title: string;
  url: string | null;
  source_name: string | null;
  notes: string | null;
  observed_value: number | null;
  confidence_score: number | null;
};

export async function createBenchmarkSource(
  input: CreateBenchmarkSourceInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.title.trim()) return { error: "Title is required" };
  if (
    input.confidence_score !== null &&
    (input.confidence_score < 0 || input.confidence_score > 1)
  ) {
    return { error: "Confidence score must be between 0 and 1" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("funnel_benchmark_source").insert({
    funnel_dataset_transition_value_id: input.funnel_dataset_transition_value_id,
    title: input.title.trim(),
    url: input.url,
    source_name: input.source_name,
    notes: input.notes,
    observed_value: input.observed_value,
    confidence_score: input.confidence_score,
  });
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export async function deleteBenchmarkSource(
  funnel_benchmark_source_id: number,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("funnel_benchmark_source")
    .delete()
    .eq("funnel_benchmark_source_id", funnel_benchmark_source_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

// ─── funnel_friction_finding (per-tenant) ────────────────────────────────

export type CreateFrictionFindingInput = {
  funnel_instance_id: number;
  funnel_friction_point_id: number;
  slug: string | null;
  severity: FunnelSeverity;
  evidence: string;
  source_system: string | null;
  observed_at: string | null; // ISO date "YYYY-MM-DD"
};

export async function createFrictionFinding(
  input: CreateFrictionFindingInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.evidence.trim()) return { error: "Evidence is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("funnel_friction_finding").insert({
    funnel_instance_id: input.funnel_instance_id,
    funnel_friction_point_id: input.funnel_friction_point_id,
    slug: input.slug,
    severity: input.severity,
    evidence: input.evidence.trim(),
    source_system: input.source_system,
    observed_at: input.observed_at,
  });
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export type UpdateFrictionFindingInput = CreateFrictionFindingInput & {
  funnel_friction_finding_id: number;
};

export async function updateFrictionFinding(
  input: UpdateFrictionFindingInput,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;
  if (!input.evidence.trim()) return { error: "Evidence is required" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("funnel_friction_finding")
    .update({
      funnel_friction_point_id: input.funnel_friction_point_id,
      slug: input.slug,
      severity: input.severity,
      evidence: input.evidence.trim(),
      source_system: input.source_system,
      observed_at: input.observed_at,
    })
    .eq("funnel_friction_finding_id", input.funnel_friction_finding_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}

export async function deleteFrictionFinding(
  funnel_friction_finding_id: number,
): Promise<ActionResult> {
  const guard = await assertAuthenticated();
  if (guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("funnel_friction_finding")
    .delete()
    .eq("funnel_friction_finding_id", funnel_friction_finding_id);
  if (error) return { error: error.message };
  invalidateFunnel();
  return { ok: true };
}
