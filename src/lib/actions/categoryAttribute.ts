"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

function revalidate() {
  revalidatePath("/catalog/categories", "page");
}

export async function addCategoryAttributeLink(categoryId: number, attributeId: number) {
  const instanceId = await currentInstanceId();
  if (!instanceId) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase.from("category_product_attribute").insert({
    instance_id: instanceId,
    category_id: categoryId,
    attribute_id: attributeId,
    is_variant_axis: false,
    requirement_level: "optional",
    visible_in_filter: true,
    visible_in_product_page: true,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function updateCategoryAttributeLink(
  mappingId: number,
  input: { is_variant_axis?: boolean; requirement_level?: string },
) {
  const instanceId = await currentInstanceId();
  if (!instanceId) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_product_attribute")
    .update(input)
    .eq("mapping_id", mappingId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function removeCategoryAttributeLink(mappingId: number) {
  const instanceId = await currentInstanceId();
  if (!instanceId) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category_product_attribute")
    .delete()
    .eq("mapping_id", mappingId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function createCategoryAttrOverride(
  categoryId: number,
  attributeId: number,
  input: { is_variant_axis: boolean; requirement_level: string },
) {
  const instanceId = await currentInstanceId();
  if (!instanceId) return { error: "No instance" };
  const supabase = await createClient();

  // Upsert: if a row already exists at this category level, update it.
  const { data: existing } = await supabase
    .from("category_product_attribute")
    .select("mapping_id")
    .eq("instance_id", instanceId)
    .eq("category_id", categoryId)
    .eq("attribute_id", attributeId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("category_product_attribute")
      .update(input)
      .eq("mapping_id", (existing as { mapping_id: number }).mapping_id)
      .eq("instance_id", instanceId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("category_product_attribute").insert({
      instance_id: instanceId,
      category_id: categoryId,
      attribute_id: attributeId,
      is_variant_axis: input.is_variant_axis,
      requirement_level: input.requirement_level,
      visible_in_filter: true,
      visible_in_product_page: true,
    });
    if (error) return { error: error.message };
  }

  revalidate();
  return { ok: true as const };
}

export async function updateCategoryParsingNote(categoryId: number, note: string) {
  const instanceId = await currentInstanceId();
  if (!instanceId) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("category")
    .update({ parsing_note: note || null })
    .eq("category_id", categoryId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}
