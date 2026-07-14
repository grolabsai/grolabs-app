import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // GroLabs admin is server-rendered by default; most pages are protected and
  // read-per-request from Supabase under the authenticated user's JWT.
  //
  // typedRoutes removed: Next.js's typedRoutes cannot prove literal route
  // strings are valid when all routes live under a dynamic [locale] segment.
  // The pattern "'/catalog/products' as Route" does not type-check cleanly
  // against RouteImpl<T> in this configuration.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
  },
  // The Get-connected page reads the merchant implementation guides from
  // docs/guides at request time (repo markdown = source of truth; no deploy
  // pipeline for content beyond the git push). Vercel's output tracing only
  // bundles files it can see imported — declare the directory explicitly or
  // production serves ENOENT.
  outputFileTracingIncludes: {
    "/[locale]/(app)/get-connected": ["./docs/guides/**/*"],
  },
  // Allow next/image to optimize Supabase Storage URLs (blog cover images).
  // The hostname is derived from NEXT_PUBLIC_SUPABASE_URL; this is the public
  // CDN domain for the project's storage bucket.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
