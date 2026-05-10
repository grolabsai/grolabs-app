import createIntlMiddleware from "next-intl/middleware";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

/**
 * Combined middleware: next-intl locale routing + Supabase session refresh.
 *
 * Order matters:
 *   1. next-intl runs first. It may redirect (e.g. /en → locale prefix) or
 *      rewrite (strip default-locale prefix). We capture its response.
 *   2. Supabase's getUser() call refreshes the auth token and writes any
 *      updated cookies onto the intl response before we return it.
 *
 * Auth-route enforcement is NOT done here — it lives in the protected
 * layout at src/app/[locale]/(app)/layout.tsx. This keeps 404s, static
 * files, and /login out of the redirect logic.
 */

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Step 1: locale routing — may produce a redirect or a locale rewrite.
  const response = intlMiddleware(request);

  // Step 2: Supabase session refresh — cookies are set on the intl response
  // so they survive regardless of whether the intl middleware redirected.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on everything EXCEPT:
    //   /api/* (route handlers serving external clients — must not be locale-prefixed)
    //   static files, images, favicons, the Next.js internals
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
