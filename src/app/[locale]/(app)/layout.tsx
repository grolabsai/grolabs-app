import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

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

  // Grab the user's current tenant (they should have exactly one in Phase 1
  // per D19). Used by the sidebar and for UX breadcrumbs.
  // Supabase types the joined `tenant` relation as an array; in practice a
  // single tenant_member row has exactly one tenant, so we normalize here.
  const { data: membership } = await supabase
    .from("tenant_member")
    .select("tenant_id, role, tenant:tenant_id(name, slug)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const tenantRel = membership?.tenant as
    | { name: string; slug: string }
    | { name: string; slug: string }[]
    | null
    | undefined;
  const tenantObj = Array.isArray(tenantRel) ? tenantRel[0] : tenantRel;
  const tenantName = tenantObj?.name ?? "Sin tenant";

  // User initials for the topbar avatar — from email local part if no name.
  const initials = (user.email ?? "??").slice(0, 2).toUpperCase();

  return (
    <div className="s-app">
      <Sidebar tenantName={tenantName} />
      <main className="s-main">
        <TopBar initials={initials} userEmail={user.email ?? ""} />
        {children}
      </main>
    </div>
  );
}
