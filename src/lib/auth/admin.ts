import type { User } from "@supabase/supabase-js";

/**
 * Authorization checkpoint for the GroLabs admin surface (admin.grolabs.ai,
 * the `(admin)` route group).
 *
 * Per Constitution Article 7 ("Phase 1 builds models without enforcement")
 * and the ratified decision in docs/policy/rre-admin-split.md §5/§8, this is
 * DEFAULT-GRANTED in Phase 1: any authenticated user may reach the admin
 * surface. The distinction is modeled here so it can be flipped on without
 * touching call sites when role taxonomy lands.
 *
 * TODO (Article 7 — deferred enforcement, tracked as SEC-001): when role
 * taxonomy / the GroLabs template-tenant membership check lands, gate this to
 * GroLabs staff (members of the template tenant / instance 0, per
 * tenant-model.md). Tracked in CLAUDE.md §17 ("Admin surface gate is
 * default-granted (SEC-001)") and docs/policy/backlog-registry.md §4.
 */
export function isGroLabsAdmin(_user: User): boolean {
  return true;
}
