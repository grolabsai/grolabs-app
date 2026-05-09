import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Thin wrapper around the `search_rate_limit_check` RPC.
 *
 * Per docs/policy/search-foundations.md §6. The RPC does an atomic
 * upsert-with-window-reset-and-increment under a row lock, so concurrent
 * calls are safe. We always use the service-role client because the search
 * API endpoints are unauthenticated (the WordPress plugin calls them without
 * a JWT) — the user-session client wouldn't authorize the RPC.
 *
 * Returns true when the request is within the cap (proceed), false when the
 * caller should respond with 429.
 */
export async function checkRateLimit(
  bucket: string,
  maxPerWindow: number,
  windowSeconds: number
): Promise<boolean> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb.rpc("search_rate_limit_check", {
    p_bucket: bucket,
    p_max: maxPerWindow,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail open on infrastructure error: better to serve a request than to
    // false-429 a legitimate caller because the rate-limit table is unreachable.
    // Logged so we notice if this becomes frequent.
    console.error("[rate-limit] RPC failed, allowing request:", error.message);
    return true;
  }
  return data === true;
}

/** Bucket key for the token endpoint, scoped per (instance, origin). */
export function tokenBucketKey(instanceId: number, origin: string): string {
  return `tok:inst=${instanceId}:origin=${origin}`;
}

/** Bucket key for the token endpoint, scoped per source IP. */
export function tokenIpBucketKey(ip: string): string {
  return `tok:ip=${ip}`;
}

export const TOKEN_PER_INSTANCE_ORIGIN_PER_MIN = 60;
export const TOKEN_PER_IP_PER_MIN = 600;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
