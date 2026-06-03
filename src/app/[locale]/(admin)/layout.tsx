import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isGroLabsAdmin } from "@/lib/auth/admin";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { AgentPanel } from "@/components/shell/AgentPanel";
import { AgentLogProvider } from "@/components/shell/AgentLogContext";
import { FieldHintProvider } from "@/components/shell/FieldHintContext";
import { MissingTranslationListener } from "@/components/i18n/MissingTranslationListener";
import { NewInstanceBanner } from "@/components/shell/NewInstanceBanner";

/**
 * Admin app layout — the GroLabs-internal management surface served on
 * admin.grolabs.ai (the `(admin)` route group; host routing lives in
 * src/middleware.ts). Mirrors the RRE (app) layout's auth gate + shell, but
 * renders the admin Sidebar nav and adds the isGroLabsAdmin checkpoint.
 *
 * The `(admin)` parentheses mean this segment does NOT appear in the URL —
 * `/content/posts` is still `/content/posts`.
 *
 * See docs/policy/rre-admin-split.md §3.4 / §5 / §6.
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

  // Authorization checkpoint — DEFAULT-GRANTED in Phase 1 (Constitution
  // Article 7; rre-admin-split.md §5). Any authenticated user passes for now;
  // isGroLabsAdmin flips on when role taxonomy lands, at which point a
  // non-admin authenticated user is hidden from the admin surface (404).
  if (!isGroLabsAdmin(user)) {
    notFound();
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
  const instanceName = currentInstance?.name ?? "";

  // User initials for the topbar avatar — from email local part if no name.
  const initials = (user.email ?? "").slice(0, 2).toUpperCase();

  return (
    <AgentLogProvider>
      <FieldHintProvider>
      <MissingTranslationListener />
      <div className="s-app">
        <Sidebar
          variant="admin"
          instanceName={instanceName}
          instances={instances}
          currentInstanceId={currentInstance?.instanceId ?? null}
        />
        <main className="s-main">
          <TopBar initials={initials} userEmail={user.email ?? ""} />
          <div className="s-shell-body">
            <div className="s-shell-content">
              <NewInstanceBanner
                currentInstanceId={currentInstance?.instanceId ?? null}
              />
              {children}
            </div>
            <AgentPanel />
          </div>
        </main>
      </div>
      </FieldHintProvider>
    </AgentLogProvider>
  );
}
