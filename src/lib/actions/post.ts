"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type PostStatus = "draft" | "scheduled" | "published";
export type PostContentFormat = "markdown" | "html";

export interface PostInput {
  title: string;
  slug: string;
  summary?: string | null;
  content: string;
  content_format?: PostContentFormat;
  cover_image_url?: string | null;
  tags?: string[];
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

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
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
      content_format: input.content_format ?? "html",
      cover_image_url: input.cover_image_url || null,
      tags: normalizeTags(input.tags),
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
      content_format: input.content_format ?? "html",
      cover_image_url: input.cover_image_url || null,
      tags: normalizeTags(input.tags),
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
  const patch: Record<string, unknown> = { status };
  if (status === "published") {
    patch.published_at = new Date().toISOString();
  } else if (status === "draft") {
    patch.published_at = null;
  }

  // Count images missing alt text. Non-blocking — we return the count
  // so the editor can warn, but the publish still goes through. Hard-
  // blocking would be annoying for decorative images.
  let missingAltCount = 0;
  if (status === "published") {
    const { data: row } = await supabase
      .from("post")
      .select("content, content_format")
      .eq("post_id", postId)
      .maybeSingle();
    if (row?.content_format === "html") {
      missingAltCount = countMissingAltImages(row.content as string);
    }
  }

  // 'scheduled' keeps the published_at that schedulePost set.
  const { error } = await supabase.from("post").update(patch).eq("post_id", postId);
  if (error) return { error: error.message };
  revalidatePath("/blog");
  revalidatePath("/content/posts");
  return { ok: true, missing_alt_count: missingAltCount };
}

/**
 * Count `<img>` tags in the HTML that have no `alt` attribute, an
 * empty `alt`, or only whitespace. Returns 0 on non-HTML content
 * (markdown legacy posts are handled by react-markdown's own
 * alt handling).
 */
function countMissingAltImages(html: string): number {
  if (!html) return 0;
  let count = 0;
  const matches = html.match(/<img[^>]*>/gi) ?? [];
  for (const tag of matches) {
    const altMatch = tag.match(/\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const alt = altMatch ? (altMatch[1] ?? altMatch[2] ?? "") : "";
    if (!alt.trim()) count++;
  }
  return count;
}

/**
 * Mark a post as scheduled with a future publish time. The Vercel cron at
 * /api/v1/blog/publish-due flips it to 'published' once the time arrives.
 */
export async function schedulePost(postId: number, isoDateTime: string) {
  const when = new Date(isoDateTime);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date" };
  if (when.getTime() <= Date.now()) return { error: "Schedule must be in the future" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("post")
    .update({ status: "scheduled", published_at: when.toISOString() })
    .eq("post_id", postId);
  if (error) return { error: error.message };
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
 * Autosave-friendly update — same as updatePost but doesn't revalidate the
 * public surface (the post isn't published yet, or content hasn't changed
 * what readers see). Used by the editor's 5s debounced save loop.
 */
export async function autosavePost(postId: number, input: PostInput) {
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
      content_format: input.content_format ?? "html",
      cover_image_url: input.cover_image_url || null,
      tags: normalizeTags(input.tags),
    })
    .eq("post_id", postId);
  if (error) return { error: error.message };
  return { ok: true, saved_at: new Date().toISOString() };
}

/**
 * Upload an image to the `blog-images` bucket. Path convention:
 *   {instance_id}/{kind}/{timestamp}-{name}
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
