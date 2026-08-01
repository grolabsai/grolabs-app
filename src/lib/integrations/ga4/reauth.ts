/**
 * GA4 reconnect state — the durable half of "use the token if it works, ask
 * the user to reconnect if it doesn't."
 *
 * `refreshAccessToken` mints a short-lived access token on every pull, so the
 * "try the token" half has always worked. What was missing is what happens
 * when Google refuses: the config screen decided connected-vs-not purely on
 * whether a refresh-token string existed in Vault, which stays true forever
 * even after the token is revoked. The user saw a permanently "connected"
 * panel while the dashboard silently went stale.
 *
 * These helpers persist that state to integrations_config.ga4 via the
 * ga4_set_reauth_state RPC (migration 20260801090555) so every surface — the
 * config page, the traffic dashboard, the nightly poller — agrees.
 *
 * Writes go through the SERVICE-ROLE client on purpose: the most important
 * caller is the nightly cron, which runs with no user session at all. The RPC
 * itself still enforces membership for non-service-role callers.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordBackendOperation } from "@/lib/observability/backend-operation";
import { Ga4OAuthError } from "./client";

/**
 * Mark this instance's GA4 connection as needing a fresh Google consent, and
 * record the failure durably so it can be queried later (per the standing
 * rule that failures land in backend_operation, not just console).
 *
 * Best-effort by design: this is called from a catch block, so it must never
 * throw and turn a reported failure into an unreported crash.
 */
export async function markGa4NeedsReauth(
  instanceId: number,
  reason: string,
): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.rpc("ga4_set_reauth_state", {
      p_instance_id: instanceId,
      p_needs_reauth: true,
      p_reason: reason,
    });
    if (error) {
      console.error("[ga4 reauth] set_reauth_state failed:", error.message);
    }
  } catch (err) {
    console.error("[ga4 reauth] set_reauth_state threw:", err);
  }

  try {
    await recordBackendOperation({
      instanceId,
      operationType: "ga4_reauth_required",
      status: "failed",
      errorMessage: reason,
      payloadSummary: { source: "refresh_token", google_error: "invalid_grant" },
    });
  } catch (err) {
    console.error("[ga4 reauth] backend_operation log failed:", err);
  }
}

/**
 * Clear the flag after a token refresh succeeds. Cheap and idempotent — we
 * call it on the success path so a connection that recovers on its own (or is
 * reconnected) stops nagging without any extra user action.
 */
export async function clearGa4NeedsReauth(instanceId: number): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.rpc("ga4_set_reauth_state", {
      p_instance_id: instanceId,
      p_needs_reauth: false,
      p_reason: null,
    });
    if (error) {
      console.error("[ga4 reauth] clear_reauth_state failed:", error.message);
    }
  } catch (err) {
    console.error("[ga4 reauth] clear_reauth_state threw:", err);
  }
}

/**
 * Bridge from a thrown error to the persisted state. Returns true when the
 * error was a permanent grant failure (and the flag was therefore set), so
 * callers can shape their own return value accordingly.
 *
 * Anything that is NOT a permanent grant failure is left alone deliberately:
 * a Google 5xx must not push the user through a pointless reconnect.
 */
export async function handleGa4TokenError(
  instanceId: number,
  err: unknown,
): Promise<boolean> {
  if (err instanceof Ga4OAuthError && err.needsReauth) {
    await markGa4NeedsReauth(instanceId, err.message);
    return true;
  }
  return false;
}
