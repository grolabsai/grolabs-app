"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";
import type {
  ConfidenceLevel,
  EffortLevel,
  ImpactLevel,
  ProbeType,
} from "./_types";

export type CheckInput = {
  check_code: string;
  check_name: string;
  description?: string | null;
  diagnostic_stage_id: number;
  probe_type: ProbeType;
  weight: number;
  revenue_lever?: string | null;
  default_delta_rate?: number | null;
  default_confidence: ConfidenceLevel;
  is_active: boolean;
  notes?: string | null;
};

export type FixInput = {
  diagnostic_check_id: number;
  fix_code: string;
  fix_title: string;
  fix_body_md: string;
  trigger_condition?: Record<string, unknown>;
  effort: EffortLevel;
  impact: ImpactLevel;
  sort_order: number;
  is_active: boolean;
};

function revalidate() {
  revalidatePath("/prospects/rubric", "page");
}

// ── Checks ─────────────────────────────────────────────────────────────────

export async function createCheck(input: CheckInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const code = input.check_code.trim();
  const name = input.check_name.trim();
  if (!code || !name) return { error: "EMPTY_REQUIRED" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("diagnostic_check")
    .insert({
      instance_id: instanceId,
      check_code: code,
      check_name: name,
      description: input.description?.trim() || null,
      diagnostic_stage_id: input.diagnostic_stage_id,
      probe_type: input.probe_type,
      weight: input.weight,
      revenue_lever: input.revenue_lever?.trim() || null,
      default_delta_rate: input.default_delta_rate,
      default_confidence: input.default_confidence,
      is_active: input.is_active,
      notes: input.notes?.trim() || null,
    })
    .select("diagnostic_check_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { diagnostic_check_id: number } };
}

export async function updateCheck(checkId: number, input: Partial<CheckInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const patch: Record<string, unknown> = {};
  if (input.check_code !== undefined) {
    const code = input.check_code.trim();
    if (!code) return { error: "EMPTY_REQUIRED" };
    patch.check_code = code;
  }
  if (input.check_name !== undefined) {
    const name = input.check_name.trim();
    if (!name) return { error: "EMPTY_REQUIRED" };
    patch.check_name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.diagnostic_stage_id !== undefined) patch.diagnostic_stage_id = input.diagnostic_stage_id;
  if (input.probe_type !== undefined) patch.probe_type = input.probe_type;
  if (input.weight !== undefined) patch.weight = input.weight;
  if (input.revenue_lever !== undefined) patch.revenue_lever = input.revenue_lever?.trim() || null;
  if (input.default_delta_rate !== undefined) patch.default_delta_rate = input.default_delta_rate;
  if (input.default_confidence !== undefined) patch.default_confidence = input.default_confidence;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("diagnostic_check")
    .update(patch)
    .eq("diagnostic_check_id", checkId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteCheck(checkId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { count } = await supabase
    .from("finding")
    .select("*", { count: "exact", head: true })
    .eq("diagnostic_check_id", checkId);
  if ((count ?? 0) > 0) return { error: `LINKED:${count}` };
  const { error } = await supabase
    .from("diagnostic_check")
    .delete()
    .eq("diagnostic_check_id", checkId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

// ── Fixes ──────────────────────────────────────────────────────────────────

export async function createFix(input: FixInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  if (!input.fix_code.trim() || !input.fix_title.trim() || !input.fix_body_md.trim()) {
    return { error: "EMPTY_REQUIRED" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fix_recommendation")
    .insert({
      instance_id: instanceId,
      diagnostic_check_id: input.diagnostic_check_id,
      fix_code: input.fix_code.trim(),
      fix_title: input.fix_title.trim(),
      fix_body_md: input.fix_body_md,
      trigger_condition: input.trigger_condition ?? {},
      effort: input.effort,
      impact: input.impact,
      sort_order: input.sort_order,
      is_active: input.is_active,
    })
    .select("fix_recommendation_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { fix_recommendation_id: number } };
}

export async function updateFix(fixId: number, input: Partial<FixInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const patch: Record<string, unknown> = {};
  if (input.fix_code !== undefined) patch.fix_code = input.fix_code.trim();
  if (input.fix_title !== undefined) patch.fix_title = input.fix_title.trim();
  if (input.fix_body_md !== undefined) patch.fix_body_md = input.fix_body_md;
  if (input.trigger_condition !== undefined) patch.trigger_condition = input.trigger_condition;
  if (input.effort !== undefined) patch.effort = input.effort;
  if (input.impact !== undefined) patch.impact = input.impact;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const supabase = await createClient();
  const { error } = await supabase
    .from("fix_recommendation")
    .update(patch)
    .eq("fix_recommendation_id", fixId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteFix(fixId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fix_recommendation")
    .delete()
    .eq("fix_recommendation_id", fixId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}
