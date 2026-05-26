"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

export type SynonymPairInput = {
  vertical_id: number;
  term_a: string;
  term_b: string;
  locale: string;
  notes?: string | null;
  is_active?: boolean;
};

export type TestQueryInput = {
  vertical_id: number;
  query_text: string;
  locale: string;
  intent: string;
  notes?: string | null;
  is_active?: boolean;
};

function revalidate() {
  revalidatePath("/prospects/rubric/vocabulary", "page");
}

// ── Synonym pairs ──────────────────────────────────────────────────────────

export async function createSynonymPair(input: SynonymPairInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  if (!input.term_a.trim() || !input.term_b.trim()) {
    return { error: "EMPTY_REQUIRED" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("vertical_synonym_pair").insert({
    instance_id: instanceId,
    vertical_id: input.vertical_id,
    term_a: input.term_a.trim(),
    term_b: input.term_b.trim(),
    locale: input.locale,
    notes: input.notes?.trim() || null,
    is_active: input.is_active ?? true,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function updateSynonymPair(
  pairId: number,
  input: Partial<SynonymPairInput>,
) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const patch: Record<string, unknown> = {};
  if (input.term_a !== undefined) patch.term_a = input.term_a.trim();
  if (input.term_b !== undefined) patch.term_b = input.term_b.trim();
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_synonym_pair")
    .update(patch)
    .eq("pair_id", pairId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteSynonymPair(pairId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_synonym_pair")
    .delete()
    .eq("pair_id", pairId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

// ── Test queries ───────────────────────────────────────────────────────────

export async function createTestQuery(input: TestQueryInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  if (!input.query_text.trim()) return { error: "EMPTY_REQUIRED" };
  const supabase = await createClient();
  const { error } = await supabase.from("vertical_test_query").insert({
    instance_id: instanceId,
    vertical_id: input.vertical_id,
    query_text: input.query_text.trim(),
    locale: input.locale,
    intent: input.intent,
    notes: input.notes?.trim() || null,
    is_active: input.is_active ?? true,
  });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function updateTestQuery(
  queryId: number,
  input: Partial<TestQueryInput>,
) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const patch: Record<string, unknown> = {};
  if (input.query_text !== undefined) patch.query_text = input.query_text.trim();
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.intent !== undefined) patch.intent = input.intent;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_test_query")
    .update(patch)
    .eq("query_id", queryId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteTestQuery(queryId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "NO_INSTANCE" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vertical_test_query")
    .delete()
    .eq("query_id", queryId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}
