"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  refreshAccessToken,
  runReport,
  Ga4OAuthError,
  Ga4ApiError,
} from "@/lib/integrations/ga4/client";
import { pullForInstance } from "@/lib/integrations/ga4/poll";
import { BACKFILL_DAYS } from "@/lib/integrations/ga4/constants";
import { runAnomalyDetection } from "@/lib/integrations/ga4/anomaly";
import type { PullResult } from "@/lib/integrations/ga4/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveInstance(): Promise<{
  instanceId: number;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) return null;
  return { instanceId: membership.instance_id };
}

// ── Save property ID ─────────────────────────────────────────────────────────

export type SavePropertyResult = {
  ok: boolean;
  error?: string;
  /**
   * Outcome of the immediate data pull kicked off by saving. `undefined` only
   * if the save itself failed before we got there.
   */
  pull?: { ok: boolean; rows: number; error?: string };
};

/**
 * After OAuth, the user enters their GA4 property ID. We store it directly in
 * integrations_config.ga4 (no Vault — it's not a secret) by re-using
 * ga4_save_credentials with the existing refresh token.
 */
export async function saveGa4PropertyId(args: {
  propertyId: string;
}): Promise<SavePropertyResult> {
  const ctx = await resolveInstance();
  if (!ctx) return { ok: false, error: "no_membership" };
  const supabase = await createClient();

  const trimmed = args.propertyId.trim();
  if (!/^\d{6,12}$/.test(trimmed)) {
    return { ok: false, error: "invalid_property_id" };
  }

  // Update integrations_config.ga4.property_id directly. We can't use
  // ga4_save_credentials because that wants a refresh_token; we don't want to
  // re-write the Vault secret on every property-id edit.
  const { data: row } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", ctx.instanceId)
    .maybeSingle();

  const existing =
    (row?.integrations_config as { ga4?: Record<string, unknown> } | null)
      ?.ga4 ?? {};

  const next = {
    ...((row?.integrations_config as Record<string, unknown> | null) ?? {}),
    ga4: { ...existing, property_id: trimmed },
  };

  const { error } = await supabase
    .from("instance")
    .update({ integrations_config: next })
    .eq("instance_id", ctx.instanceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuration/ga4");

  // Saving the property ID is the natural moment to fetch data — otherwise the
  // dashboard stays empty until the daily 06:00 UTC cron. Pull immediately
  // (best-effort: the save already succeeded, so a pull failure doesn't fail
  // the save — we just report it back). pullForInstance never throws.
  const pull = await pullForInstance({
    instanceId: ctx.instanceId,
    propertyId: trimmed,
    trailingDays: BACKFILL_DAYS,
  });
  if (pull.ok) {
    await runAnomalyDetection({ instanceId: ctx.instanceId });
  }
  revalidatePath("/dashboard/traffic");

  const rows =
    pull.rowsBySurface.session +
    pull.rowsBySurface.traffic +
    pull.rowsBySurface.page +
    pull.rowsBySurface.geo +
    pull.rowsBySurface.device;

  return {
    ok: true,
    pull: pull.ok
      ? { ok: true, rows }
      : { ok: false, rows: 0, error: pull.error },
  };
}

// ── Test connection ──────────────────────────────────────────────────────────

export type TestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message?: string;
};

/**
 * Probe: refresh token + tiny runReport for yesterday. Doesn't touch tables.
 */
export async function testGa4Connection(): Promise<TestResult> {
  const ctx = await resolveInstance();
  if (!ctx) {
    return { ok: false, status: 0, latencyMs: 0, message: "no_membership" };
  }
  const supabase = await createClient();
  const start = Date.now();

  const { data: refreshTok } = await supabase.rpc("ga4_get_refresh_token", {
    p_instance_id: ctx.instanceId,
  });
  if (!refreshTok || typeof refreshTok !== "string") {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      message: "no_refresh_token",
    };
  }

  const { data: row } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", ctx.instanceId)
    .maybeSingle();
  const propertyId =
    ((row?.integrations_config as { ga4?: { property_id?: string } } | null)
      ?.ga4?.property_id ?? "") || null;
  if (!propertyId) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      message: "no_property_id",
    };
  }

  try {
    const { access_token } = await refreshAccessToken(refreshTok);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);
    await runReport({
      propertyId,
      accessToken: access_token,
      request: {
        dateRanges: [{ startDate: date, endDate: date }],
        metrics: [{ name: "sessions" }],
      },
    });
    return { ok: true, status: 200, latencyMs: Date.now() - start };
  } catch (err) {
    const status =
      err instanceof Ga4ApiError
        ? err.status
        : err instanceof Ga4OAuthError
          ? 401
          : 0;
    return {
      ok: false,
      status,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ── Pull now ─────────────────────────────────────────────────────────────────

export async function pullNowGa4(): Promise<PullResult> {
  const ctx = await resolveInstance();
  if (!ctx) {
    return {
      instanceId: -1,
      ok: false,
      latencyMs: 0,
      error: "no_membership",
      rowsBySurface: { session: 0, traffic: 0, page: 0, geo: 0, device: 0 },
    };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("instance")
    .select("integrations_config")
    .eq("instance_id", ctx.instanceId)
    .maybeSingle();
  const propertyId =
    ((row?.integrations_config as { ga4?: { property_id?: string } } | null)
      ?.ga4?.property_id ?? "") || "";

  if (!propertyId) {
    return {
      instanceId: ctx.instanceId,
      ok: false,
      latencyMs: 0,
      error: "no_property_id",
      rowsBySurface: { session: 0, traffic: 0, page: 0, geo: 0, device: 0 },
    };
  }

  const result = await pullForInstance({
    instanceId: ctx.instanceId,
    propertyId,
    trailingDays: BACKFILL_DAYS,
  });

  if (result.ok) {
    await runAnomalyDetection({ instanceId: ctx.instanceId });
  }

  revalidatePath("/configuration/ga4");
  revalidatePath("/dashboard/traffic");
  return result;
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectGa4(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await resolveInstance();
  if (!ctx) return { ok: false, error: "no_membership" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ga4_clear_credentials", {
    p_instance_id: ctx.instanceId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/configuration/ga4");
  revalidatePath("/dashboard/traffic");
  return { ok: true };
}
