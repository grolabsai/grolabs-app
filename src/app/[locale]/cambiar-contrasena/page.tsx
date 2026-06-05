import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * Forced first-login password change screen. Lives OUTSIDE the (app)/(admin)
 * route groups so the layouts can redirect here without a loop. Reachable on
 * both hosts (middleware PUBLIC_PREFIXES). Per docs/policy/user-management.md §6.
 */
export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const t = await getTranslations("auth.changePassword");

  return (
    <div className="s-auth-shell">
      <div className="s-auth-card">
        <div className="s-auth-brand">
          <div className="s-brand-mark" />
          <span className="s-brand-name">GroLabs</span>
        </div>
        <h1 className="s-auth-title">{t("title")}</h1>
        <p className="s-auth-sub">{t("sub")}</p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
