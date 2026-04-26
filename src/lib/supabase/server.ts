import { createServerClient as _createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client. Reads the user's session from cookies so the JWT
 * flows through to Postgres — which is what makes RLS work automatically.
 *
 * This is the default client for server components and route handlers.
 * Every query made through this client is scoped to the authenticated user
 * via `public.current_tenant_id()` in the RLS policies.
 *
 * For admin flows that must bypass RLS (imports, reconciliation,
 * cross-tenant reads), use `createServiceRoleClient()` instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` throws from server components. Middleware handles
            // the actual cookie refresh — this catch lets reads still work.
          }
        },
      },
    },
  );
}
