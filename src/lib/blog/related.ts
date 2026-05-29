import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface RelatedPost {
  post_id: number;
  title: string;
  slug: string;
  summary: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  tags: string[] | null;
  score: number;
}

/**
 * Find posts related to the given one by tag overlap. Same instance,
 * published, not the source post itself. Ranked by tag-overlap count
 * (descending), then by `published_at` (recency) as the tiebreaker.
 *
 * If the source has no tags or no other tagged posts exist, falls back
 * to the most-recent 3 published posts in the instance — so the
 * "Related" block isn't empty on early posts.
 */
export async function getRelatedPosts(
  source: { post_id: number; instance_id: number; tags: string[] | null },
  limit = 3,
): Promise<RelatedPost[]> {
  const supabase = createServiceRoleClient();
  const tags = source.tags ?? [];

  if (tags.length > 0) {
    const { data } = await supabase
      .from("post")
      .select("post_id, title, slug, summary, cover_image_url, published_at, tags")
      .eq("instance_id", source.instance_id)
      .eq("status", "published")
      .neq("post_id", source.post_id)
      .overlaps("tags", tags)
      .order("published_at", { ascending: false })
      .limit(20);

    const ranked = (data ?? [])
      .map((p) => {
        const postTags = (p.tags as string[] | null) ?? [];
        const score = postTags.filter((t) => tags.includes(t)).length;
        return { ...(p as RelatedPost), score };
      })
      .sort((a, b) => b.score - a.score || 0)
      .slice(0, limit);

    if (ranked.length >= limit) return ranked;
  }

  // Fallback: recent posts.
  const { data: recent } = await supabase
    .from("post")
    .select("post_id, title, slug, summary, cover_image_url, published_at, tags")
    .eq("instance_id", source.instance_id)
    .eq("status", "published")
    .neq("post_id", source.post_id)
    .order("published_at", { ascending: false })
    .limit(limit);

  return ((recent ?? []) as RelatedPost[]).map((p) => ({ ...p, score: 0 }));
}
