"use client";

import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown when an authenticated user reaches a surface they cannot use and the
 * only safe escape is to sign out (a plain redirect to /login would loop — the
 * session is still valid, so /login bounces them straight back). Two callers:
 *   - orphan accounts with no active instance membership (the default
 *     "auth.noAccess" copy — user-management.md §5.2), and
 *   - a non-GroLabs user who landed on the admin host (`messageKey
 *     ="auth.noAdminAccess"`).
 * The sign-out button clears the session and returns to /login.
 */
export function NoAccess({
  messageKey = "auth.noAccess",
}: {
  messageKey?: "auth.noAccess" | "auth.noAdminAccess";
}) {
  const t = useTranslations(messageKey);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="s-auth-shell">
      <div className="s-auth-card">
        <div className="s-auth-brand">
          <div className="s-brand-mark" />
          <span className="s-brand-name">GroLabs</span>
        </div>
        <h1 className="s-auth-title">{t("title")}</h1>
        <p className="s-auth-sub">{t("body")}</p>
        <button
          type="button"
          className="s-btn s-btn-primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
          onClick={signOut}
        >
          {t("signOut")}
        </button>
      </div>
    </div>
  );
}
