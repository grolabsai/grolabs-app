import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { AgentPanel } from "@/components/shell/AgentPanel";
import { AgentLogProvider } from "@/components/shell/AgentLogContext";

/**
 * Protected app layout. Every route under `(app)/` inherits this:
 *   - Auth gate (unauthenticated → /login)
 *   - Sidebar
 *   - Topbar with search + user avatar
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

  // Grab the user's current instance (they should have exactly one in
  // Phase 1 per D19). Used by the sidebar to show which instance is active.
  // Supabase types the joined `instance` relation as an array; in practice a
  // single instance_member row has exactly one instance, so we normalize here.
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id, role, instance:instance_id(name, slug, kind)")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  const instanceRel = membership?.instance as
    | { name: string; slug: string; kind: string }
    | { name: string; slug: string; kind: string }[]
    | null
    | undefined;
  const instanceObj = Array.isArray(instanceRel) ? instanceRel[0] : instanceRel;
  const instanceName = instanceObj?.name ?? "Sin instancia";

  // User initials for the topbar avatar — from email local part if no name.
  const initials = (user.email ?? "??").slice(0, 2).toUpperCase();

  return (
    <AgentLogProvider>
      <div className="s-app">
        <Sidebar instanceName={instanceName} />
        <main className="s-main">
          <TopBar initials={initials} userEmail={user.email ?? ""} />
          <div className="s-shell-body">
            <div className="s-shell-content">{children}</div>
            <AgentPanel />
          </div>
        </main>
      </div>
    </AgentLogProvider>
  );
}
