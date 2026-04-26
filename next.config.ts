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
};

export default withNextIntl(nextConfig);
