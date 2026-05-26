"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

export type BenchmarkInput = {
  vertical_id: number;
  diagnostic_stage_id: number | null;
  diagnostic_check_id: number | null;
  baseline_cr: number | null;
  stage_share: number | null;
  delta_rate: number | null;
  default_aov_usd: number | null;
  source: string | null;
  effective_from: string; // YYYY-MM-DD
  notes: string | null;
};

function revalidate() {
  revalidatePath("/prospects/benchmarks", "page");
}

export async function createBenchmark(input: BenchmarkInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vertical_benchmark")
    .insert({
      instance_id: instanceId,
      vertical_id: input.vertical_id,
      diagnostic_stage_id: input.diagnostic_stage_id,
      diagnostic_check_id: input.diagnostic_check_id,
      baseline_cr: input.baseline_cr,
      stage_share: input.stage_share,
      delta_rate: input.delta_rate,
      default_aov_usd: input.default_aov_usd,
      source: input.source,
      effective_from: input.effective_from,
      notes: input.notes,
    })
    .select("vertical_benchmark_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { vertical_benchmark_id: number } };
}

export async function updateBenchmark(id: number, input: Partial<BenchmarkInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_benchmark")
    .update(input)
    .eq("vertical_benchmark_id", id)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteBenchmark(id: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_benchmark")
    .delete()
    .eq("vertical_benchmark_id", id)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}
