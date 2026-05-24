import { createClient } from "@/lib/supabase/server";

/**
 * Per-post page-view counts from the ga4_page_daily snapshot table.
 *
 * GA4 is integrated for the SaaS dashboard already (see policy
 * `ga4-integration.md`). This helper just slices it for blog paths.
 * No new pipeline — daily pull populates ga4_page_daily, this
 * aggregates by page_path for the writer's slugs.
 *
 * Match accepts both `/blog/{slug}` and `/blog/{slug}/` to be robust
 * against trailing-slash variants GA4 sometimes records separately.
 * Locale-prefixed paths (e.g. `/en/blog/foo`) are NOT counted in this
 * v1 — add if posts on `/en/blog/*` start accumulating views.
 */
export interface PostViewCount {
  slug: string;
  views_30d: number;
}

export async function getPostViewCounts(
  instanceId: number,
  slugs: string[],
  windowDays = 30,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (slugs.length === 0) return out;

  const supabase = await createClient();
  const since = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Build the path list — two variants per slug.
  const paths = slugs.flatMap((s) => [`/blog/${s}`, `/blog/${s}/`]);

  const { data } = await supabase
    .from("ga4_page_daily")
    .select("page_path, views")
    .eq("instance_id", instanceId)
    .gte("date", since)
    .in("page_path", paths);

  for (const row of (data ?? []) as Array<{
    page_path: string;
    views: number;
  }>) {
    // Strip the optional trailing slash to get back the slug key.
    const m = row.page_path.match(/^\/blog\/([^/]+)\/?$/);
    if (!m) continue;
    const slug = m[1];
    out.set(slug, (out.get(slug) ?? 0) + (row.views ?? 0));
  }
  return out;
}
