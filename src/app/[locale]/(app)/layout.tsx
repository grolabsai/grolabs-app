import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSwitcherInstances } from "@/lib/shell/switcher";
import { isCurrentTenantAdmin } from "@/lib/auth/roles";
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
 * Protected app layout. Every route under `(app)/` inherits this:
 *   - Auth gate (unauthenticated → /login)
 *   - Forced first-login password change (user-management.md §6)
 *   - No-access gate for orphan accounts (user-management.md §5.2)
 *   - Sidebar (with the Tenant-Admin "Equipo" item) + Topbar
 *
 * The `(app)` parentheses mean this segment does NOT appear in the URL —
 * `/catalog/products` is still `/catalog/products`, not `/app/catalog/products`.
 */
export default async function AppLayout({
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

  // Forced first-login password change — block the app until the generated
  // password is replaced. Only applies to PASSWORD sessions: an SSO sign-in
  // has no password to change, so we gate on the provider of the current
  // session (`app_metadata.provider`). An account provisioned with a password
  // can also have a Google/Microsoft identity linked; when they come in via
  // SSO the provider is 'google'/'azure' and the gate is correctly skipped.
  const signInProvider = user.app_metadata?.provider ?? "email";
  if (
    signInProvider === "email" &&
    user.user_metadata?.must_change_password === true
  ) {
    redirect("/cambiar-contrasena");
  }

  // Instance switcher list. GroLabs staff get every tenant's instances
  // ("domain — instance"); everyone else gets their own active memberships.
  const { instances, currentInstanceId } = await loadSwitcherInstances(user.id);

  // No active membership → orphan account (e.g. an SSO sign-in that slipped
  // through). Sign them out; nothing in the app is reachable.
  if (instances.length === 0) {
    return <NoAccess />;
  }

  const isTenantAdmin = await isCurrentTenantAdmin();
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
          instanceName={instanceName}
          instances={instances}
          currentInstanceId={currentInstanceId}
          isTenantAdmin={isTenantAdmin}
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
