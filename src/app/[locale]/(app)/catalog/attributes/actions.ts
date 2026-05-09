"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

export type AttributeInput = {
  attribute_code: string;
  attribute_name: string;
  description?: string | null;
  parsing_hint?: string | null;
  data_type?: string | null;
  dimension?: string | null;
  is_multivalue?: boolean;
  is_filterable?: boolean;
  is_searchable?: boolean;
  is_active?: boolean;
};

export type OptionInput = {
  value: string;
  value_code?: string | null;
  sort_order?: number | null;
  is_active?: boolean;
};

function revalidate() {
  revalidatePath("/catalog/attributes", "page");
}

export async function createAttribute(input: AttributeInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_attribute")
    .insert({ instance_id: instanceId, ...input })
    .select("attribute_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { attribute_id: number } };
}

export async function updateAttribute(attributeId: number, input: Partial<AttributeInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_attribute")
    .update(input)
    .eq("attribute_id", attributeId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

/**
 * Append the supplied terms to an attribute's parsing_hint, deduping
 * against the existing hint text. Used by the import wizard's post-
 * success "hint review" panel to teach the agent from successful
 * extractions. Returns the new hint string for the caller to display.
 */
export async function appendAttributeParsingHint(
  attributeId: number,
  terms: string[],
) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const cleanTerms = Array.from(
    new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0)),
  );
  if (cleanTerms.length === 0) return { ok: true as const, data: { parsing_hint: null } };
  const supabase = await createClient();
  const { data: existing, error: readErr } = await supabase
    .from("product_attribute")
    .select("parsing_hint")
    .eq("attribute_id", attributeId)
    .eq("instance_id", instanceId)
    .single();
  if (readErr) return { error: readErr.message };
  const current = (existing?.parsing_hint ?? "").trim();
  const lower = current.toLowerCase();
  const additions = cleanTerms.filter((t) => !lower.includes(t.toLowerCase()));
  if (additions.length === 0) return { ok: true as const, data: { parsing_hint: current || null } };
  const next = current
    ? `${current}\nAlso recognize: ${additions.join(", ")}.`
    : `Recognize: ${additions.join(", ")}.`;
  const { error: writeErr } = await supabase
    .from("product_attribute")
    .update({ parsing_hint: next })
    .eq("attribute_id", attributeId)
    .eq("instance_id", instanceId);
  if (writeErr) return { error: writeErr.message };
  revalidate();
  return { ok: true as const, data: { parsing_hint: next } };
}

export async function deleteAttribute(attributeId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { count } = await supabase
    .from("category_product_attribute")
    .select("*", { count: "exact", head: true })
    .eq("attribute_id", attributeId)
    .eq("instance_id", instanceId);
  if ((count ?? 0) > 0) return { error: `LINKED:${count}` };
  const { error } = await supabase
    .from("product_attribute")
    .delete()
    .eq("attribute_id", attributeId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function addAttributeOption(attributeId: number, input: OptionInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_attribute_option")
    .insert({ instance_id: instanceId, attribute_id: attributeId, ...input })
    .select("value_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { value_id: number } };
}

export async function updateAttributeOption(optionId: number, input: Partial<OptionInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_attribute_option")
    .update(input)
    .eq("value_id", optionId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteAttributeOption(optionId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_attribute_option")
    .delete()
    .eq("value_id", optionId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function reorderAttributeOptions(attributeId: number, optionIds: number[]) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  for (let i = 0; i < optionIds.length; i++) {
    await supabase
      .from("product_attribute_option")
      .update({ sort_order: i + 1 })
      .eq("value_id", optionIds[i])
      .eq("instance_id", instanceId);
  }
  revalidate();
  return { ok: true as const };
}
