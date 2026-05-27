"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";

export type VariantInput = {
  variant_type: "canonical" | "typo" | "synonym" | "plural" | "partial";
  query_text: string;
  notes?: string | null;
};

export type CreateEntryInput = {
  prospect_id: number;
  intent_label: string;
  locale?: string;
  notes?: string | null;
  variants: VariantInput[];
};

export type UpdateEntryInput = {
  entry_id: number;
  prospect_id: number;
  intent_label?: string;
  locale?: string;
  notes?: string | null;
  is_active?: boolean;
  variants?: VariantInput[]; // when provided, replaces all variants
};

/**
 * Create a new search-test entry under a prospect. The first variant
 * must be of type "canonical" (the intended query). Additional
 * variants test typos, synonyms, etc. against the same intent.
 */
export async function createEntry(input: CreateEntryInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const label = input.intent_label.trim();
  if (label.length === 0) return { error: "EMPTY_LABEL" };

  const cleanVariants = (input.variants ?? [])
    .map((v) => ({
      variant_type: v.variant_type,
      query_text: v.query_text.trim(),
      notes: v.notes?.trim() || null,
    }))
    .filter((v) => v.query_text.length > 0);

  if (!cleanVariants.some((v) => v.variant_type === "canonical")) {
    return { error: "NEEDS_CANONICAL" };
  }

  const supabase = await createClient();
  const { data: entry, error: entryErr } = await supabase
    .from("search_test_entry")
    .insert({
      prospect_id: input.prospect_id,
      instance_id: instanceId,
      intent_label: label,
      locale: input.locale ?? "en",
      notes: input.notes?.trim() || null,
    })
    .select("entry_id")
    .single();
  if (entryErr || !entry) return { error: entryErr?.message ?? "INSERT_FAILED" };

  const variantRows = cleanVariants.map((v, i) => ({
    entry_id: entry.entry_id,
    variant_type: v.variant_type,
    query_text: v.query_text,
    notes: v.notes,
    sort_order: i,
  }));
  const { error: varErr } = await supabase
    .from("search_test_variant")
    .insert(variantRows);
  if (varErr) return { error: varErr.message };

  revalidatePath(`/prospects/${input.prospect_id}/vocabulary`);
  return { ok: true, entry_id: entry.entry_id };
}

/**
 * Update an existing entry. If `variants` is provided, replaces the
 * entire variant list (simpler than diffing). Other fields are patched
 * if present.
 */
export async function updateEntry(input: UpdateEntryInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (input.intent_label !== undefined)
    patch.intent_label = input.intent_label.trim();
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("search_test_entry")
      .update(patch)
      .eq("entry_id", input.entry_id);
    if (error) return { error: error.message };
  }

  if (input.variants !== undefined) {
    const cleanVariants = input.variants
      .map((v) => ({
        variant_type: v.variant_type,
        query_text: v.query_text.trim(),
        notes: v.notes?.trim() || null,
      }))
      .filter((v) => v.query_text.length > 0);
    if (!cleanVariants.some((v) => v.variant_type === "canonical")) {
      return { error: "NEEDS_CANONICAL" };
    }
    await supabase
      .from("search_test_variant")
      .delete()
      .eq("entry_id", input.entry_id);
    const variantRows = cleanVariants.map((v, i) => ({
      entry_id: input.entry_id,
      variant_type: v.variant_type,
      query_text: v.query_text,
      notes: v.notes,
      sort_order: i,
    }));
    const { error } = await supabase
      .from("search_test_variant")
      .insert(variantRows);
    if (error) return { error: error.message };
  }

  revalidatePath(`/prospects/${input.prospect_id}/vocabulary`);
  return { ok: true };
}

export async function deleteEntry(entryId: number, prospectId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("search_test_entry")
    .delete()
    .eq("entry_id", entryId);
  if (error) return { error: error.message };
  revalidatePath(`/prospects/${prospectId}/vocabulary`);
  return { ok: true };
}
