"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

/**
 * Update a category's default variant axes and parsing note.
 * These guide the AI agent when parsing product names.
 */
export async function updateVariantConfig(
  categoryId: number,
  defaultVariantAxes: string[],
  parsingNote: string | null
) {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  const { error } = await supabase
    .from("category")
    .update({
      default_variant_axes: defaultVariantAxes,
      parsing_note: parsingNote || null,
    })
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/catalog/categories");
  revalidatePath(`/catalog/categories/${categoryId}`);
  return { success: true };
}

/**
 * Load a single category with its variant config and attribute mappings.
 */
export async function loadCategoryDetail(categoryId: number) {
  const supabase = await createClient();
  const instanceId = await currentInstanceId();

  // Load the category
  const { data: category, error: catError } = await supabase
    .from("category")
    .select(
      "category_id, category_name, slug, description, level, parent_category_id, default_variant_axes, parsing_note, is_active"
    )
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId)
    .single();

  if (catError || !category) {
    return { category: null, attributes: [], breadcrumb: [] };
  }

  // Load attributes mapped to this category
  const { data: attributeMappings } = await supabase
    .from("category_product_attribute")
    .select(
      "mapping_id, requirement_level, form_order, attribute:attribute_id(attribute_id, attribute_name, attribute_code, data_type)"
    )
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId)
    .order("form_order", { ascending: true });

  // Build breadcrumb by walking up the tree
  const breadcrumb: { id: number; name: string }[] = [];
  let currentId: number | null = category.parent_category_id;
  const visited = new Set<number>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const { data: parent } = await supabase
      .from("category")
      .select("category_id, category_name, parent_category_id")
      .eq("category_id", currentId)
      .eq("instance_id", instanceId)
      .single();

    if (!parent) break;
    breadcrumb.unshift({ id: parent.category_id, name: parent.category_name });
    currentId = parent.parent_category_id;
  }

  breadcrumb.push({ id: category.category_id, name: category.category_name });

  return {
    category,
    attributes: (attributeMappings ?? []).map((m: any) => ({
      mappingId: m.mapping_id,
      requirementLevel: m.requirement_level,
      formOrder: m.form_order,
      ...(Array.isArray(m.attribute) ? m.attribute[0] : m.attribute),
    })),
    breadcrumb,
  };
}
