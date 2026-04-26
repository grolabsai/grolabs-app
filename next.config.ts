import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Scout admin is server-rendered by default; most pages are protected and
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
};

export default withNextIntl(nextConfig);
