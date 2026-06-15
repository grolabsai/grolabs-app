import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isGroLabsAdmin } from "@/lib/auth/admin";
import { loadSwitcherInstances } from "@/lib/shell/switcher";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { AgentPanel } from "@/components/shell/AgentPanel";
import { AgentLogProvider } from "@/components/shell/AgentLogContext";
import { AgentPanelProvider } from "@/components/shell/AgentPanelContext";
import { FieldHintProvider } from "@/components/shell/FieldHintContext";
import { MissingTranslationListener } from "@/components/i18n/MissingTranslationListener";
import { NewInstanceBanner } from "@/components/shell/NewInstanceBanner";
import { NoAccess } from "@/components/auth/NoAccess";

/**
 * Admin app layout — the GroLabs-internal management surface served on
 * admin.grolabs.ai (the `(admin)` route group; host routing lives in
 * src/middleware.ts). Mirrors the RRE (app) layout's auth gate + shell, but
 * renders the admin Sidebar nav and enforces the REAL isGroLabsAdmin check
 * (user-management.md §8, closes SEC-001).
 *
 * The `(admin)` parentheses mean this segment does NOT appear in the URL —
 * `/content/posts` is still `/content/posts`.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Forced first-login password change — same gate as the RRE surface. Only
  // applies to PASSWORD sessions; an SSO sign-in (provider 'google'/'azure')
  // has no password to change, so it is exempt.
  const signInProvider = user.app_metadata?.provider ?? "email";
  if (
    signInProvider === "email" &&
    user.user_metadata?.must_change_password === true
  ) {
    redirect("/cambiar-contrasena");
  }

  // Authorization checkpoint — REAL CHECK (user-management.md §8, closes
  // SEC-001). Only members of the GroLabs template-owner tenant reach the
  // admin surface. A non-admin authenticated user gets a sign-out screen
  // (NOT notFound) so they can switch accounts — a bare redirect to /login
  // would loop (their session is still valid) and a 404 would trap them with
  // no way to log out.
  if (!(await isGroLabsAdmin())) {
    return <NoAccess messageKey="auth.noAdminAccess" />;
  }

  // GroLabs staff see every tenant's instances ("domain — instance").
  const { instances, currentInstanceId } = await loadSwitcherInstances(user.id);
  if (instances.length === 0) {
    return <NoAccess />;
  }

  const currentInstance =
    instances.find((i) => i.instanceId === currentInstanceId) ?? null;
  const instanceName = currentInstance?.name ?? "";
  const initials = (user.email ?? "").slice(0, 2).toUpperCase();

  return (
    <AgentLogProvider>
      <AgentPanelProvider>
      <FieldHintProvider>
      <MissingTranslationListener />
      <div className="s-app">
        <Sidebar
          variant="admin"
          instanceName={instanceName}
          instances={instances}
          currentInstanceId={currentInstanceId}
        />
        <main className="s-main">
          <TopBar initials={initials} userEmail={user.email ?? ""} />
          <div className="s-shell-body">
            <div className="s-shell-content">
              <NewInstanceBanner currentInstanceId={currentInstanceId} />
              {children}
            </div>
            <AgentPanel />
          </div>
        </main>
      </div>
      </FieldHintProvider>
      </AgentPanelProvider>
    </AgentLogProvider>
  );
}
