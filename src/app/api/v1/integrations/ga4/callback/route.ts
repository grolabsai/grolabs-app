/**
 * GET /api/v1/integrations/ga4/callback
 *
 * Google redirects here after consent. We:
 *   1. Verify the state cookie matches the query parameter (CSRF defense).
 *   2. Exchange the auth code for refresh + access tokens.
 *   3. Decode the id_token to capture the connected Google account email.
 *   4. (Property ID is configured by the user post-connect — Google's OAuth
 *       doesn't return it, so we accept the connection now and require the
 *       user to enter the property ID on the configuration page.)
 *
 * Step 4 means we store the refresh_token under the instance immediately
 * but `property_id` lives in integrations_config.ga4 only after the user
 * fills it in on /configuration/ga4. The polling job ignores instances
 * without a property_id (ga4_list_active_instances filters them out).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  emailFromIdToken,
  exchangeCodeForTokens,
  resolveRedirectUri,
  Ga4OAuthError,
} from "@/lib/integrations/ga4/client";

export const runtime = "nodejs";

const STATE_COOKIE = "ga4_oauth_state";

function redirectWithError(req: NextRequest, code: string): NextResponse {
  const url = new URL("/configuration/ga4", req.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return redirectWithError(req, "user_denied");
  }
  if (!code || !state) {
    return redirectWithError(req, "missing_params");
  }

  const cookieState = req.cookies.get(STATE_COOKIE)?.value ?? null;
  if (!cookieState || cookieState !== state) {
    return redirectWithError(req, "state_mismatch");
  }

  const [instanceIdStr] = state.split(":");
  const instanceId = Number(instanceIdStr);
  if (!Number.isFinite(instanceId)) {
    return redirectWithError(req, "invalid_state");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership || membership.instance_id !== instanceId) {
    return redirectWithError(req, "membership_mismatch");
  }

  // Exchange code → tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri: resolveRedirectUri(req.nextUrl.origin),
    });
  } catch (err) {
    const msg = err instanceof Ga4OAuthError ? err.message : "exchange_failed";
    console.error("[ga4 callback] token exchange failed:", msg);
    return redirectWithError(req, "exchange_failed");
  }

  if (!tokens.refresh_token) {
    // Google only issues refresh_token on the first consent or with prompt=consent.
    // We force prompt=consent in the auth URL so this is rare; surface clearly.
    return redirectWithError(req, "no_refresh_token");
  }

  const email = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;

  // Save credentials. property_id is left blank — user fills it in on the
  // configuration page next.
  const { error: saveErr } = await supabase.rpc("ga4_save_credentials", {
    p_instance_id: instanceId,
    p_property_id: "",
    p_oauth_account_email: email ?? "",
    p_refresh_token: tokens.refresh_token,
  });
  if (saveErr) {
    console.error("[ga4 callback] save_credentials failed:", saveErr.message);
    return redirectWithError(req, "save_failed");
  }

  const res = NextResponse.redirect(
    new URL("/configuration/ga4?connected=1", req.url),
  );
  res.cookies.delete(STATE_COOKIE);
  return res;
}
