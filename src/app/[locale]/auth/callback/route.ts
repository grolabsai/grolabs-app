import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Google / Microsoft (azure) redirect here after sign-in; we
 * exchange the authorization code for a Supabase session (cookies set via the
 * server client) and bounce to `next`. Public route — reachable unauthenticated
 * on both hosts (middleware PUBLIC_PREFIXES includes /auth).
 *
 * Per docs/policy/user-management.md §5. Access is enforced elsewhere: the
 * Before-User-Created hook (rejects unknown emails) and the layout no-access
 * gate (signs out an authenticated user with no memberships).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Default locale (es) has no prefix; "/" routes through middleware which
      // sends the admin host to /prospects and the RRE host home → /dashboard.
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : `/${next}`}`);
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
