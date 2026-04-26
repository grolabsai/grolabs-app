import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Login page. Public route (not inside the `(app)` protected group).
 *
 * Design note: this page is intentionally stripped of sidebar/topbar
 * chrome. It uses `s-auth-shell` for centered card layout.
 *
 * Phase 1 limitations:
 *   - Email + password only. Google / magic link deferred (D17 noted this).
 *   - No sign-up flow — users are provisioned out-of-band (for Wazu,
 *     Tuncho's account was seeded directly in `auth.users`). A public
 *     sign-up + claim_tenant flow comes later.
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

  redirect("/dashboard");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // If already signed in, skip straight to the catalog.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="s-auth-shell">
      <div className="s-auth-card">
        <div className="s-auth-brand">
          <div className="s-brand-mark" />
          <span className="s-brand-name">Scout</span>
        </div>
        <h1 className="s-auth-title">Ingresá a tu catálogo</h1>
        <p className="s-auth-sub">
          Administración multi-tenant de catálogos de e-commerce.
        </p>

        {error ? (
          <div className="s-auth-error">
            No pudimos iniciar sesión. Verificá tu correo y contraseña.
          </div>
        ) : null}

        <form action={login}>
          <div className="s-field">
            <label className="s-field-label" htmlFor="email">
              Correo
            </label>
            <input
              className="s-input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="tuncho@wazu.test"
            />
          </div>
          <div className="s-field">
            <label className="s-field-label" htmlFor="password">
              Contraseña
            </label>
            <input
              className="s-input"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            className="s-btn s-btn-primary"
            type="submit"
            style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
          >
            Ingresar
          </button>
        </form>

        <p className="s-auth-footnote">Scout · {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_DATE}</p>
      </div>
    </div>
  );
}
