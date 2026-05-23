import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostEditor } from "../_editor";
import type { PostStatus, PostContentFormat } from "@/lib/actions/post";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isFinite(postId)) notFound();

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("post")
    .select(
      "post_id, title, slug, summary, content, content_format, cover_image_url, status, tags, published_at",
    )
    .eq("post_id", postId)
    .maybeSingle();

  if (!post) notFound();

  const { data: shortLink } = await supabase
    .from("short_link")
    .select("code")
    .eq("post_id", postId)
    .maybeSingle();

  return (
    <PostEditor
      initial={{
        post_id: post.post_id as number,
        title: post.title as string,
        slug: post.slug as string,
        summary: post.summary as string | null,
        content: post.content as string,
        content_format: post.content_format as PostContentFormat,
        cover_image_url: post.cover_image_url as string | null,
        status: post.status as PostStatus,
        tags: (post.tags as string[] | null) ?? [],
        published_at: post.published_at as string | null,
        short_link_code: (shortLink?.code as string | undefined) ?? null,
      }}
    />
  );
}
