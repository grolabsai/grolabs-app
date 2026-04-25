import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Scout admin is server-rendered by default; most pages are protected and
  // read-per-request from Supabase under the authenticated user's JWT.
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
