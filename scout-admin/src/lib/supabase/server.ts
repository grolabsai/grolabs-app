import { createServerClient as _createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client. Reads the user's session from cookies so the JWT
 * flows through to Postgres — which is what makes RLS work automatically.
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
          cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as any),
            );
          } catch {
            // setAll throws from server components. Middleware handles refresh.
          }
        },
      },
    },
  );
}
