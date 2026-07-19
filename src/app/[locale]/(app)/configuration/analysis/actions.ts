"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  WEEK_DAYS, mergeAnalysisConfig,
  type AnalysisConfig, type WeekDay,
} from "@/lib/analytics/analysis-config";

/**
 * Analysis settings — the named discrete operation (CLAUDE.md §14) that both
 * the form and a future agent call. Updates instance.timezone,
 * instance.default_currency and instance.analysis_config for the CURRENT
 * instance (RLS scopes the write to the member's own instance).
 */

export interface AnalysisSettingsPayload {
  timezone: string;
  currency: string;
  week_end_day: WeekDay;
  delta_threshold_pct: number;
  min_weekly_denominator: number;
  baseline_weeks: number;
  metric_goals: Record<string, { target?: number | null; lower_threshold?: number | null }>;
}

export type SaveResult = { ok: boolean; error?: "auth" | "timezone" | "values" | "db" };

async function currentInstance(): Promise<number | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  return data?.instance_id ?? null;
}

export async function updateAnalysisConfig(payload: AnalysisSettingsPayload): Promise<SaveResult> {
  const instanceId = await currentInstance();
  if (instanceId === null) return { ok: false, error: "auth" };

  // Validate timezone against the runtime's IANA database.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: payload.timezone });
  } catch {
    return { ok: false, error: "timezone" };
  }
  if (!WEEK_DAYS.includes(payload.week_end_day)) return { ok: false, error: "values" };
  const dt = Number(payload.delta_threshold_pct);
  const md = Number(payload.min_weekly_denominator);
  const bw = Number(payload.baseline_weeks);
  if (!(dt > 0 && dt <= 100) || !(md >= 0) || !(bw >= 3 && bw <= 26)) {
    return { ok: false, error: "values" };
  }
  const currency = payload.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "values" };

  const config: AnalysisConfig = mergeAnalysisConfig({
    week_end_day: payload.week_end_day,
    delta_threshold_pct: dt,
    min_weekly_denominator: md,
    baseline_weeks: bw,
    metric_goals: payload.metric_goals,
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("instance")
    .update({
      timezone: payload.timezone,
      default_currency: currency,
      analysis_config: config,
      updated_at: new Date().toISOString(),
    })
    .eq("instance_id", instanceId);
  if (error) {
    console.error("[analysis-config] save failed:", error.message);
    return { ok: false, error: "db" };
  }
  revalidatePath("/configuration/analysis");
  revalidatePath("/dashboard/signals");
  revalidatePath("/dashboard/overview");
  return { ok: true };
}
