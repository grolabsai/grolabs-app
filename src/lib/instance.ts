import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Resolve the current instance_id for the authenticated user.
 *
 * Per D26, every row in every table is scoped to an `instance_id`.
 * Customer instances (kind='customer') hold tenant data; template
 * instances (kind='template') are GroLabs-owned source data used only
 * during signup and ops flows.
 *
 * RLS now allows authenticated users to see ONLY rows in their own
 * instance — template rows are reachable only via service-role.
 * That means callers no longer need to add an explicit instance_id
 * filter in most cases, but it's still good practice for clarity
 * and for double-protection against bugs in RLS configuration.
 *
 * SELF-HEALING INVARIANT: a user with active memberships must always have
 * exactly one with `is_current = true`. Provisioning can violate this — when
 * an *existing* account is added to an instance, `is_current` is only set for
 * brand-new accounts (src/lib/actions/users.ts), so a reused account can end
 * up with active memberships but no current one. The old RPC-based resolver
 * then returned null, and the dashboard redirected the (authenticated) user to
 * /login → /login bounced them back → ERR_TOO_MANY_REDIRECTS. We now repair
 * the state on read: if nothing is current, promote the lowest-numbered active
 * membership and persist it (service-role, since it spans the user's rows).
 *
 * React's `cache()` dedupes calls within a single request so even if
 * multiple server components ask, we hit the DB (and self-heal) once.
 */
export const currentInstanceId = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rows, error } = await supabase
    .from("instance_member")
    .select("instance_id, is_current")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (error) {
    console.error("[currentInstanceId] membership lookup failed:", error);
    return null;
  }
  const memberships = (rows ?? []) as { instance_id: number; is_current: boolean }[];

  const current = memberships.find((r) => r.is_current)?.instance_id;
  if (current != null) return current;
  if (memberships.length === 0) return null;

  // Self-heal: active memberships exist but none is current. Promote the
  // lowest instance_id (deterministic). No is_current row exists yet, so this
  // can't violate the partial unique index on (user_id) WHERE is_current.
  const target = memberships.map((r) => r.instance_id).sort((a, b) => a - b)[0];
  const admin = createServiceRoleClient();
  const { error: healErr } = await admin
    .from("instance_member")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("instance_id", target);
  if (healErr) {
    // Persistence failed (e.g. service-role hiccup) — still return the target
    // so the page renders this request; the next load retries the heal.
    console.error("[currentInstanceId] self-heal failed:", healErr);
  }
  return target;
});
