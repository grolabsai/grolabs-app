/**
 * GET /api/v1/integrations/ga4/auth
 *
 * Initiates the Google OAuth flow. Resolves the caller's instance_id from
 * their Supabase session, stamps a `state` cookie binding the flow to that
 * instance, and 302s to Google's consent screen.
 *
 * The state cookie is HttpOnly + Secure + SameSite=Lax with a 10-minute TTL
 * so the callback can verify the flow originated here. We use a random nonce
 * so even a maliciously-leaked redirect URL can't be replayed.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthUrl, resolveRedirectUri } from "@/lib/integrations/ga4/client";

export const runtime = "nodejs";

const STATE_COOKIE = "ga4_oauth_state";
const STATE_TTL_SECONDS = 600;

export async function GET(req: NextRequest) {
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
  if (!membership) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const instanceId: number = membership.instance_id;

  const nonce = randomBytes(24).toString("base64url");
  const statePayload = `${instanceId}:${nonce}`;

  const redirectUri = resolveRedirectUri(req.nextUrl.origin);
  const url = buildAuthUrl({ redirectUri, state: statePayload });

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, statePayload, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
