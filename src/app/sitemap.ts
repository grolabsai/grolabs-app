import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Sitemap for the public blog surface. Scoped to the requesting host:
 *   - If `host` maps to an instance via `instance.domain`, include only
 *     that instance's published posts.
 *   - Otherwise (admin domain, preview URL), include all published
 *     posts. The admin domain has no public reading surface mapped to
 *     a real product domain, so the sitemap there is informational.
 *
 * Returns the canonical `/blog/[slug]` URLs only. Tag pages and the
 * /blog index are surfaced separately.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const rawHost = h.get("host") ?? h.get("x-forwarded-host") ?? "localhost";
  const host = rawHost.toLowerCase().split(":")[0];
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${rawHost}`;

  const supabase = createServiceRoleClient();

  const { data: instanceRow } = await supabase
    .from("instance")
    .select("instance_id")
    .eq("domain", host)
    .maybeSingle();

  let q = supabase
    .from("post")
    .select("slug, published_at, updated_at, tags")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5000);
  if (instanceRow?.instance_id != null) q = q.eq("instance_id", instanceRow.instance_id);
  const { data: posts } = await q;

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${origin}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  const tagSet = new Set<string>();
  for (const p of posts ?? []) {
    entries.push({
      url: `${origin}/blog/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: "weekly",
      priority: 0.6,
    });
    for (const tag of (p.tags as string[] | null) ?? []) tagSet.add(tag);
  }

  for (const tag of tagSet) {
    entries.push({
      url: `${origin}/blog?tag=${encodeURIComponent(tag)}`,
      changeFrequency: "weekly",
      priority: 0.3,
    });
  }

  return entries;
}
