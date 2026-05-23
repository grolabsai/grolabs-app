"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type PostStatus = "draft" | "published";

export interface PostInput {
  title: string;
  slug: string;
  summary?: string | null;
  content: string;
  cover_image_url?: string | null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function createPost(input: PostInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const slug = slugify(input.slug || input.title);
  if (!slug) return { error: "Invalid slug" };

  const { data, error } = await supabase
    .from("post")
    .insert({
      instance_id: instanceId,
      author_id: user.id,
      title: input.title.trim(),
      slug,
      summary: input.summary?.trim() || null,
      content: input.content,
      cover_image_url: input.cover_image_url || null,
      status: "draft",
    })
    .select("post_id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/blog");
  revalidatePath("/content/posts");
  return { post_id: data.post_id as number };
}

export async function updatePost(postId: number, input: PostInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();
  const slug = slugify(input.slug || input.title);
  if (!slug) return { error: "Invalid slug" };

  const { error } = await supabase
    .from("post")
    .update({
      title: input.title.trim(),
      slug,
      summary: input.summary?.trim() || null,
      content: input.content,
      cover_image_url: input.cover_image_url || null,
    })
    .eq("post_id", postId);

  if (error) return { error: error.message };

  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  revalidatePath("/content/posts");
  return { ok: true };
}

export async function setPostStatus(postId: number, status: PostStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("post")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .eq("post_id", postId);

  if (error) return { error: error.message };

  revalidatePath("/blog");
  revalidatePath("/content/posts");
  return { ok: true };
}

export async function deletePost(postId: number) {
  const supabase = await createClient();
  const { error } = await supabase.from("post").delete().eq("post_id", postId);
  if (error) return { error: error.message };
  revalidatePath("/blog");
  revalidatePath("/content/posts");
  redirect("/content/posts");
}

/**
 * Upload an image to the `blog-images` bucket. Path convention:
 *   {instance_id}/{kind}/{timestamp}-{name}
 * `kind` is "cover" or "inline"; both end up in the same bucket but the
 * subfolder makes manual cleanup possible later.
 */
export async function uploadPostImage(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const file = formData.get("file");
  const kind = (formData.get("kind") as string) || "inline";
  if (!(file instanceof File)) return { error: "No file provided" };
  if (file.size > 8 * 1024 * 1024) return { error: "File exceeds 8 MB" };

  const supabase = await createClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${instanceId}/${kind}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("blog-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data } = supabase.storage.from("blog-images").getPublicUrl(path);
  return { url: data.publicUrl };
}
