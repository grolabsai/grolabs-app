import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

/**
 * Protected app layout. Every route under `(app)/` inherits this:
 *   - Auth gate (unauthenticated → /login)
 *   - Sidebar (with instance name)
 *   - Topbar with search + user avatar
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

  // Grab the user's current instance (D26: one user, one instance in Phase 1)
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id, role, instance:instance_id(name, slug, kind)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const instanceRel = membership?.instance as
    | { name: string; slug: string; kind: string }
    | { name: string; slug: string; kind: string }[]
    | null
    | undefined;
  const instanceObj = Array.isArray(instanceRel) ? instanceRel[0] : instanceRel;
  const instanceName = instanceObj?.name ?? "Sin instancia";

  const initials = (user.email ?? "??").slice(0, 2).toUpperCase();

  return (
    <div className="s-app">
      <Sidebar instanceName={instanceName} />
      <main className="s-main">
        <TopBar initials={initials} userEmail={user.email ?? ""} />
        {children}
      </main>
    </div>
  );
}
