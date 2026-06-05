"use client";

import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown when an authenticated user has no active instance membership — the
 * belt-and-suspenders half of the "pre-created emails only" rule
 * (docs/policy/user-management.md §5.2). An orphan SSO user lands here and can
 * only sign out; nothing else is reachable.
 */
export function NoAccess() {
  const t = useTranslations("auth.noAccess");

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
