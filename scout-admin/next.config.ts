import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  // Scout admin is server-rendered by default; most pages are protected and
  // read-per-request from Supabase under the authenticated user's JWT.
  typedRoutes: true,

  // Expose the package version to the client. We use this in the sidebar
  // and login footer so we (and the user) can confirm at a glance which
  // build is running, without inspecting the terminal.
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
