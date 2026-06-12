"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ensureMembership(): Promise<number | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  return membership?.instance_id ?? null;
}

export async function acknowledgeAlert(
  alertId: number,
): Promise<{ ok: boolean; error?: string }> {
  const instanceId = await ensureMembership();
  if (instanceId === null) return { ok: false, error: "no_membership" };
  const supabase = await createClient();
  // RLS gates by instance_id; we additionally constrain to the alert id.
  const { error } = await supabase
    .from("ga4_alert")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
    })
    .eq("alert_id", alertId)
    .eq("instance_id", instanceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/traffic");
  return { ok: true };
}

export async function clearAlert(
  alertId: number,
): Promise<{ ok: boolean; error?: string }> {
  const instanceId = await ensureMembership();
  if (instanceId === null) return { ok: false, error: "no_membership" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ga4_alert")
    .update({
      status: "cleared",
      cleared_at: new Date().toISOString(),
    })
    .eq("alert_id", alertId)
    .eq("instance_id", instanceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/traffic");
  return { ok: true };
}
