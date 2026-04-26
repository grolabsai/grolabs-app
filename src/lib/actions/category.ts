"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

/**
 * Update the variant axis configuration for a category.
 * Writes axis data to category_product_attribute (is_variant_axis + variant_axis_order)
 * and updates only parsing_note on the category row.
 * Instance-scoped: only updates categories belonging to the current user's instance.
 */
export async function updateVariantConfig(
  categoryId: number,
  axes: string[], // attribute codes
  parsingNote: string | null,
) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    return { error: "No instance" };
  }

  const supabase = await createClient();

  // Look up attribute IDs from codes
  const codesFilter = axes.length > 0 ? axes : ["__none__"];
  const { data: attrs, error: attrError } = await supabase
    .from("product_attribute")
    .select("attribute_id, attribute_code")
    .eq("instance_id", instanceId)
    .in("attribute_code", codesFilter);

  if (attrError) {
    return { error: attrError.message };
  }

  const codeToId = new Map(
    (attrs ?? []).map((a) => [a.attribute_code as string, a.attribute_id as number]),
  );

  // Clear all existing variant axis flags for this category
  const { error: clearError } = await supabase
    .from("category_product_attribute")
    .update({ is_variant_axis: false, variant_axis_order: null })
    .eq("instance_id", instanceId)
    .eq("category_id", categoryId)
    .eq("is_variant_axis", true);

  if (clearError) {
    return { error: clearError.message };
  }

  // Set is_variant_axis + order for each new axis
  for (let i = 0; i < axes.length; i++) {
    const attributeId = codeToId.get(axes[i]);
    if (!attributeId) continue;

    const { error: upsertError } = await supabase
      .from("category_product_attribute")
      .upsert(
        {
          instance_id: instanceId,
          category_id: categoryId,
          attribute_id: attributeId,
          is_variant_axis: true,
          variant_axis_order: i + 1,
        },
        { onConflict: "instance_id,category_id,attribute_id" },
      );

    if (upsertError) {
      return { error: upsertError.message };
    }
  }

  // Update only parsing_note on category
  const { error: noteError } = await supabase
    .from("category")
    .update({ parsing_note: parsingNote || null })
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId);

  if (noteError) {
    return { error: noteError.message };
  }

  revalidatePath("/catalog/categories", "page");
  return { ok: true };
}
