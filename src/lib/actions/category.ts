"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

/**
 * Update the variant axis configuration for a category.
 * Writes `default_variant_axes` and `parsing_note` to the category row.
 * Instance-scoped: only updates categories belonging to the current user's instance.
 */
export async function updateVariantConfig(
  categoryId: number,
  axes: string[],
  parsingNote: string | null,
) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    return { error: "No instance" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("category")
    .update({
      default_variant_axes: axes,
      parsing_note: parsingNote || null,
    })
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/catalog/categories", "page");
  return { ok: true };
}
