import createIntlMiddleware from "next-intl/middleware";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

/**
 * Combined middleware: next-intl locale routing + Supabase session refresh +
 * host → route-group separation.
 *
 * Order matters:
 *   1. next-intl runs first. It may redirect (e.g. /en → locale prefix) or
 *      rewrite (strip default-locale prefix). We capture its response.
 *   2. Supabase's getUser() call refreshes the auth token and writes any
 *      updated cookies onto the intl response before we return it.
 *   3. Host routing decides which surface (route group) this host may serve.
 *
 * Auth-route enforcement is NOT done here — it lives in the protected
 * layouts at src/app/[locale]/(app)/layout.tsx and (admin)/layout.tsx. This
 * keeps 404s, static files, and /login out of the redirect logic.
 */

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Host that renders the GroLabs admin surface (the `(admin)` route group).
 * A static infrastructure allow-list constant — deliberately NOT a DB lookup
 * (unlike instance.domain, used for the public blog), per
 * docs/policy/rre-admin-split.md §3.3 / §6.
 */
const ADMIN_HOST = "admin.grolabs.ai";

/**
 * Path prefixes (locale-stripped) owned by the `(admin)` group. Reachable
 * only on ADMIN_HOST; they 404 on every other host.
 */
const ADMIN_PREFIXES = ["/content", "/prospects", "/clientes"];

/**
 * Public, host-agnostic surfaces — reachable on every host (no auth gate, or
 * shared backend). Everything that is neither admin nor public is the RRE
 * `(app)` surface, reachable on every host EXCEPT the admin host.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth", // OAuth callback (/auth/callback) — reachable unauthenticated, both hosts
  "/cambiar-contrasena", // forced first-login password change — both hosts
  "/blog",
  "/diagnostics",
  "/legal",
  "/styleguide",
];
const PUBLIC_ROOT_FILES = ["/rss.xml", "/llms.txt", "/robots.txt", "/sitemap.xml"];

function hostFromRequest(request: NextRequest): string {
  // Match the blog helpers (src/lib/blog/host.ts): host header, with
  // x-forwarded-host fallback (Vercel sets it), lowercased + port-stripped.
  const raw =
    request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  return raw.toLowerCase().split(":")[0];
}

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

function matchesPrefix(logical: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => logical === p || logical.startsWith(`${p}/`));
}

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

  // Step 3: host → route-group separation. The admin host serves only the
  // `(admin)` group + public surfaces; every other host serves only the RRE
  // `(app)` group + public surfaces. Mismatches 404 as if the route did not
  // exist on this host. API routes never reach here (excluded by the matcher).
  const isAdminHost = hostFromRequest(request) === ADMIN_HOST;
  const logical = stripLocale(request.nextUrl.pathname);

  // Admin landing: the home page server-redirects to /dashboard (an RRE
  // route, blocked on the admin host). Send admin-host root to the admin
  // default landing instead (rre-admin-split.md §8).
  if (isAdminHost && logical === "/") {
    return NextResponse.redirect(new URL("/prospects", request.url));
  }

  const isAdminPath = matchesPrefix(logical, ADMIN_PREFIXES);
  const isPublic =
    logical === "/" ||
    logical.startsWith("/s/") ||
    matchesPrefix(logical, PUBLIC_PREFIXES) ||
    PUBLIC_ROOT_FILES.includes(logical);

  const blocked = isAdminPath ? !isAdminHost : isAdminHost && !isPublic;
  if (blocked) {
    // Rewrite to a path with no matching route → Next renders its 404.
    return NextResponse.rewrite(new URL("/_gl_host_not_found", request.url));
  }

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
