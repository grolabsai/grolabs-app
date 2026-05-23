import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PostEditor } from "../_editor";

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
      "post_id, title, slug, summary, content, cover_image_url, status",
    )
    .eq("post_id", postId)
    .maybeSingle();

  if (!post) notFound();

  return (
    <PostEditor
      initial={{
        post_id: post.post_id as number,
        title: post.title as string,
        slug: post.slug as string,
        summary: post.summary as string | null,
        content: post.content as string,
        cover_image_url: post.cover_image_url as string | null,
        status: post.status as "draft" | "published",
      }}
    />
  );
}
