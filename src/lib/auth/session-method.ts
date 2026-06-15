import type { User } from "@supabase/supabase-js";

/**
 * Authentication method of the CURRENT session.
 *
 * Why this exists: `user.app_metadata.provider` is the account's PRIMARY
 * identity and never changes per session. An email-first account that later
 * links Google still reads `provider: 'email'` even while signed in with
 * Google. So it CANNOT be used to tell "did this session use a password or
 * SSO." The reliable signal is the JWT `amr` claim (Authentication Methods
 * Reference): Supabase sets `oauth` / `sso` for SSO logins and `password` for
 * password logins.
 */

function amrMethods(accessToken: string | undefined): string[] {
  if (!accessToken) return [];
  const segment = accessToken.split(".")[1];
  if (!segment) return [];
  try {
    const payload = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    ) as { amr?: Array<{ method?: string } | string> };
    if (!Array.isArray(payload.amr)) return [];
    return payload.amr
      .map((entry) => (typeof entry === "string" ? entry : entry?.method))
      .filter((m): m is string => Boolean(m));
  } catch {
    return [];
  }
}

/**
 * True when the current session was authenticated with a password (so a forced
 * password change is meaningful). SSO sessions return false — they have no
 * password to change, and forcing the flow on them caused a redirect loop.
 *
 * Fallback when `amr` can't be read (older tokens): a user whose only identity
 * is `email` could only have signed in by password, so treat it as a password
 * session; anyone with an SSO identity is treated as non-password (fail toward
 * NOT blocking SSO, which is the behavior we want).
 */
export function wasPasswordSession(
  accessToken: string | undefined,
  user: User,
): boolean {
  const methods = amrMethods(accessToken);
  if (methods.length > 0) return methods.includes("password");
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
  return !providers.some((p) => p !== "email");
}
