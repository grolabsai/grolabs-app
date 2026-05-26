"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import {
  startDiagnostic as runStartDiagnostic,
  type StartDiagnosticInput,
} from "@/lib/diagnostic/runner";

export async function startDiagnostic(input: StartDiagnosticInput) {
  if (!input.url || !input.url.trim()) {
    return { error: "EMPTY_URL" };
  }
  const result = await runStartDiagnostic(input);
  revalidatePath("/prospects", "page");
  if ("ok" in result) {
    revalidatePath(`/prospects/runs/${result.runId}`, "page");
  }
  return result;
}

/**
 * Persist traffic/AOV on a prospect (creates the prospect row if missing
 * for a fresh URL). Called from the new-run form before the diagnostic
 * fires so the revenue formula has inputs to consume.
 */
export async function setProspectEconomics(input: {
  url: string;
  est_annual_traffic: number | null;
  est_aov_usd: number | null;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const normalized = input.url
    .trim()
    .replace(/^(?!https?:\/\/)/i, "https://")
    .replace(/\/+$/, "");
  const { data: existing } = await supabase
    .from("prospect")
    .select("prospect_id")
    .eq("instance_id", instanceId)
    .eq("url", normalized)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("prospect")
      .update({
        est_annual_traffic: input.est_annual_traffic,
        est_aov_usd: input.est_aov_usd,
      })
      .eq("prospect_id", existing.prospect_id);
  } else {
    await supabase.from("prospect").insert({
      instance_id: instanceId,
      url: normalized,
      est_annual_traffic: input.est_annual_traffic,
      est_aov_usd: input.est_aov_usd,
    });
  }
  return { ok: true as const };
}
