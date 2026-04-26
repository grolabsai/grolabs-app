"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses the anon key; cookie-based auth sessions
 * are read directly from `document.cookie` by `@supabase/ssr`.
 *
 * Usage: client components that need realtime or client-side queries.
 * Server components should use `createServerClient()` from `./server`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
