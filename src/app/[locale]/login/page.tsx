import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { SsoButtons } from "@/components/auth/SsoButtons";
import { LoginForm } from "./LoginForm";

/**
 * Login page. Public route (not inside the `(app)` protected group).
 *
 * Design note: this page is intentionally stripped of sidebar/topbar
 * chrome. It uses `s-auth-shell` for centered card layout. SSO (Google +
 * Microsoft) is the primary path and leads; email + password is the
 * secondary fallback below the divider.
 */

async function login(formData: FormData) {
  "use server";

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Bounce back to the login page with a coded error. We don't echo
    // Supabase's raw message to the UI — it's noisy and sometimes leaks
    // implementation details.
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Land on "/" and let middleware route per-host: the RRE host's home
  // redirects to /dashboard, the admin host's root goes to /prospects.
  // Hardcoding /dashboard here 404s on the admin host (it's an RRE-only route).
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const t = await getTranslations("auth.login");

  // If already signed in, skip straight through. "/" lets middleware route
  // per-host (RRE → /dashboard, admin → /prospects); /dashboard is RRE-only.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="s-auth-shell">
      <div className="s-auth-card">
        <div className="s-auth-brand">
          <div className="s-brand-mark" />
          <span className="s-brand-name">GroLabs</span>
        </div>
        <h1 className="s-auth-title">{t("title")}</h1>
        <p className="s-auth-sub">{t("sub")}</p>

        {error ? <div className="s-auth-error">{t("error")}</div> : null}

        {/* SSO is the primary path — Google + Microsoft lead. GroLabs-styled,
            pre-created emails only. See docs/policy/user-management.md §5. */}
        <div style={{ marginTop: 16 }}>
          <SsoButtons />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "16px 0",
            color: "var(--gl-text-tertiary)",
            fontSize: 11,
          }}
        >
          <span style={{ flex: 1, height: 1, background: "var(--gl-border)" }} />
          {t("emailDivider")}
          <span style={{ flex: 1, height: 1, background: "var(--gl-border)" }} />
        </div>

        {/* Email + password — secondary fallback. The submit button stays
            muted until a password is typed (see LoginForm). */}
        <LoginForm action={login} />

        <p className="s-auth-footnote">GroLabs · {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_DATE}</p>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            justifyContent: "center",
            gap: 14,
            fontSize: 10,
            color: "var(--gl-text-tertiary)",
          }}
        >
          <Link href="/legal/privacy" style={{ color: "var(--gl-text-tertiary)" }}>
            Privacy · Privacidad
          </Link>
          <Link href="/legal/terms" style={{ color: "var(--gl-text-tertiary)" }}>
            Terms · Términos
          </Link>
          <Link href="/legal/security" style={{ color: "var(--gl-text-tertiary)" }}>
            Security · Seguridad
          </Link>
        </div>
      </div>
    </div>
  );
}
