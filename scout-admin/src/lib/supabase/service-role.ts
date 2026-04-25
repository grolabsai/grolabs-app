import { createClient as _createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely. Use ONLY from
 * server-side code that performs privileged operations:
 *
 *   - copy_instance(source, target) on signup
 *   - imports from external systems
 *   - reconciliation jobs
 *   - cross-tenant administration
 *
 * Never import this from client components. Never return its output
 * directly to the browser without explicit tenant-scoping in the query.
 *
 * The service role key must not be set as `NEXT_PUBLIC_*` — it's a
 * server-only secret.
 */
export function createServiceRoleClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Service-role operations cannot run.",
    );
  }
  return _createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
