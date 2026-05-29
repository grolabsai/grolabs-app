import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * /robots.txt — point crawlers at the host-aware sitemap.
 * Allow everything by default; specific Disallow rules can be added
 * here later (e.g. /content/posts admin paths, which are gated by
 * server-side auth anyway).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const rawHost = h.get("host") ?? h.get("x-forwarded-host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${rawHost}`;

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/content/", "/api/", "/login"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: rawHost,
  };
}
