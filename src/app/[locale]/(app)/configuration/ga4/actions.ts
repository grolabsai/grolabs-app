"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  refreshAccessToken,
  runReport,
  listAccountSummaries,
  Ga4OAuthError,
  Ga4ApiError,
  type Ga4PropertySummary,
} from "@/lib/integrations/ga4/client";
import {
  clearGa4NeedsReauth,
  handleGa4TokenError,
} from "@/lib/integrations/ga4/reauth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
  // Resolve via is_current — the SAME key the traffic dashboard uses
  // (dashboard/traffic/page.tsx) — so an on-save / Pull-now write always lands
  // in the instance the dashboard reads. is_current has a per-user partial
  // unique index, so .maybeSingle() can't error for multi-instance users (the
  // old is_active filter could match several rows and throw, failing every GA4
  // action). See instance-management migration 20260510000010.
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  if (!membership) return null;
  return { instanceId: membership.instance_id };
}

// ── Save property ID ─────────────────────────────────────────────────────────

export type SavePropertyResult = {
  ok: boolean;
  error?: string;
  /**
   * Rows discarded because the property CHANGED (history belonged to the old
   * property). 0 on a first-time set or a re-save of the same property.
   */
  purgedRows?: number;
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

  // Is this a CHANGE of an already-configured property, or a first-time set?
  // The distinction matters: every stored snapshot row belongs to the OLD
  // property, so keeping them would silently blend two sites' history into one
  // dashboard — a worse bug than the one the picker fixes.
  const previous =
    typeof existing.property_id === "string" ? existing.property_id : "";
  const isPropertyChange = previous !== "" && previous !== trimmed;

  const next = {
    ...((row?.integrations_config as Record<string, unknown> | null) ?? {}),
    ga4: { ...existing, property_id: trimmed },
  };

  const { error } = await supabase
    .from("instance")
    .update({ integrations_config: next })
    .eq("instance_id", ctx.instanceId);

  if (error) return { ok: false, error: error.message };

  let purgedRows = 0;
  if (isPropertyChange) {
    purgedRows = await purgeGa4Snapshots(ctx.instanceId);
  }

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
    purgedRows,
    pull: pull.ok
      ? { ok: true, rows }
      : { ok: false, rows: 0, error: pull.error },
  };
}

// ── Property change — snapshot purge ─────────────────────────────────────────

/** Every GA4 snapshot surface, keyed by instance_id. */
const GA4_SNAPSHOT_TABLES = [
  "ga4_session_daily",
  "ga4_traffic_daily",
  "ga4_page_daily",
  "ga4_geo_daily",
  "ga4_device_daily",
  "ga4_alert",
] as const;

/**
 * Discard an instance's stored GA4 history after the property changed.
 *
 * Service-role, because this spans several tables and must complete even if a
 * given table's RLS policy would not allow a plain member DELETE. Returns the
 * number of rows removed for the confirmation toast.
 *
 * NOT called on a reconnect of the SAME property — reconnecting restores an
 * existing setup and must never destroy history.
 */
async function purgeGa4Snapshots(instanceId: number): Promise<number> {
  const admin = createServiceRoleClient();
  let total = 0;
  for (const table of GA4_SNAPSHOT_TABLES) {
    const { count, error } = await admin
      .from(table)
      .delete({ count: "exact" })
      .eq("instance_id", instanceId);
    if (error) {
      console.error(`[ga4] purge ${table} failed:`, error.message);
      continue;
    }
    total += count ?? 0;
  }
  return total;
}

// ── Property discovery (Admin API) ───────────────────────────────────────────

export type ListPropertiesResult =
  | { ok: true; properties: Ga4PropertySummary[] }
  | { ok: false; error: string; needsReauth?: boolean };

/**
 * List every GA4 property the stored token can reach, so the user picks from a
 * named dropdown instead of pasting a 9-digit number.
 *
 * Uses the existing analytics.readonly scope — no re-consent, and existing
 * connections keep working. Never throws across the server-action boundary;
 * the form falls back to manual entry whenever this returns ok:false.
 */
export async function listGa4Properties(): Promise<ListPropertiesResult> {
  const ctx = await resolveInstance();
  if (!ctx) return { ok: false, error: "no_membership" };
  const supabase = await createClient();

  const { data: refreshTok } = await supabase.rpc("ga4_get_refresh_token", {
    p_instance_id: ctx.instanceId,
  });
  if (!refreshTok || typeof refreshTok !== "string") {
    return { ok: false, error: "no_refresh_token" };
  }

  try {
    const { access_token } = await refreshAccessToken(refreshTok);
    await clearGa4NeedsReauth(ctx.instanceId);
    const properties = await listAccountSummaries(access_token);
    return { ok: true, properties };
  } catch (err) {
    const needsReauth = await handleGa4TokenError(ctx.instanceId, err);
    if (needsReauth) revalidatePath("/configuration/ga4");
    return {
      ok: false,
      needsReauth,
      error: err instanceof Error ? err.message : "unknown_error",
    };
  }
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
    await clearGa4NeedsReauth(ctx.instanceId);
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
    // Test connection is the action a user reaches for when something looks
    // wrong — so it must be able to say "your Google access lapsed", not just
    // "401".
    if (await handleGa4TokenError(ctx.instanceId, err)) {
      revalidatePath("/configuration/ga4");
    }
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
