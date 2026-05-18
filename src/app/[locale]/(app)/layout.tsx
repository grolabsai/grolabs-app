import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { ActivityStream } from "@/components/shell/ActivityStream";
import { ActivityStreamProvider } from "@/components/shell/ActivityStreamContext";

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

  // Pull every active membership for the user. We need the full set so the
  // topbar dropdown can list all instances; the current one is the row with
  // is_current=true (the partial unique index guarantees at most one).
  // Supabase types the joined `instance` relation as an array; in practice a
  // membership row has exactly one instance, so we normalize at the boundary.
  const { data: memberships } = await supabase
    .from("instance_member")
    .select("instance_id, is_current, instance:instance_id(name, slug, kind)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  type InstanceRel = { name: string; slug: string; kind: string } | null;
  const normalized = (memberships ?? []).map((m) => {
    const rel = m.instance as InstanceRel | InstanceRel[] | null | undefined;
    const obj: InstanceRel = Array.isArray(rel) ? rel[0] ?? null : rel ?? null;
    return {
      instanceId: m.instance_id as number,
      name: obj?.name ?? "",
      isCurrent: !!m.is_current,
    };
  });
  const instances = normalized
    .filter((i) => i.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const currentInstance = instances.find((i) => i.isCurrent) ?? null;
  const instanceName = currentInstance?.name ?? "Sin instancia";

  // User initials for the topbar avatar — from email local part if no name.
  const initials = (user.email ?? "??").slice(0, 2).toUpperCase();

  return (
    <ActivityStreamProvider>
      <div className="s-app">
        <Sidebar instanceName={instanceName} />
        <main className="s-main">
          <TopBar
            initials={initials}
            userEmail={user.email ?? ""}
            instances={instances}
            currentInstanceId={currentInstance?.instanceId ?? null}
          />
          <div className="s-shell-body">
            <div className="s-shell-content">{children}</div>
            <ActivityStream />
          </div>
        </main>
      </div>
    </ActivityStreamProvider>
  );
}
