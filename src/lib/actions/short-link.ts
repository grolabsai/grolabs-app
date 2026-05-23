"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l for legibility
const CODE_LENGTH = 6;
const MAX_RETRIES = 8;

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export interface ShortLinkRow {
  short_link_id: number;
  code: string;
  target_url: string;
  click_count: number;
  post_id: number | null;
}

/**
 * Get the existing short link for a post, if any.
 */
export async function getShortLinkForPost(postId: number): Promise<ShortLinkRow | null> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("short_link")
    .select("short_link_id, code, target_url, click_count, post_id")
    .eq("instance_id", instanceId)
    .eq("post_id", postId)
    .maybeSingle();
  return (data as ShortLinkRow | null) ?? null;
}

/**
 * Mint a short link for a post. Idempotent — if one already exists,
 * returns the existing row. Otherwise generates a unique code, inserts,
 * and returns the new row.
 */
export async function ensureShortLinkForPost(
  postId: number,
  targetUrl: string,
): Promise<{ ok: true; data: ShortLinkRow } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "No instance" };

  const existing = await getShortLinkForPost(postId);
  if (existing) return { ok: true, data: existing };

  const supabase = await createClient();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from("short_link")
      .insert({
        instance_id: instanceId,
        code,
        target_url: targetUrl,
        post_id: postId,
      })
      .select("short_link_id, code, target_url, click_count, post_id")
      .single();
    if (!error && data) {
      revalidatePath("/content/posts");
      return { ok: true, data: data as ShortLinkRow };
    }
    // Unique violation on code or on (instance_id, post_id). If post_id
    // collision, another tab just created one — re-read it and return.
    if (error?.message?.includes("short_link_instance_post_unique")) {
      const again = await getShortLinkForPost(postId);
      if (again) return { ok: true, data: again };
    }
    // Otherwise retry with a new code (code collision).
  }

  return { ok: false, error: "Could not generate a unique short code" };
}
