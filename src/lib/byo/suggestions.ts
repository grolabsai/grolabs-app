import type { SupabaseClient } from "@supabase/supabase-js";
import {
  stitchProductObjects,
  type StagingRow,
  type DataDictionary,
} from "./stitch";
import { inferFieldMap, applyFieldMap } from "./field-map";
import { groupVariants } from "./group";

/**
 * Persist a session's refinement proposals into catalog_suggestion — the
 * existing confirm store ("nothing writes to production until confirmed via this
 * table"). This wires the bulk-intake pipeline (field-map → group) into the
 * confirm loop (P6) rather than returning on-the-fly JSON.
 *
 * Each run is idempotent: prior *pending* proposals for the job are cleared
 * first, so re-proposing replaces rather than duplicates. Writes use the
 * service-role client with explicit instance_id (RLS-bypassing bulk path).
 */

export type ProposeResult = {
  cleared: number;
  column_mapping_id: number | null;
  product_suggestions: number;
};

type LibError = { ok: false; error: string };

export async function generateProposals(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
  rows: StagingRow[],
  dictionary: DataDictionary,
): Promise<{ ok: true; result: ProposeResult } | LibError> {
  const { products } = stitchProductObjects(rows, dictionary);
  const { mapping, unmapped } = inferFieldMap(products);
  const mapped = products.map((p) => applyFieldMap(p, mapping));
  const { products: grouped } = groupVariants(mapped);

  // Idempotent re-run: drop prior pending proposals for this job.
  const { count: cleared, error: delErr } = await sb
    .from("catalog_suggestion")
    .delete({ count: "exact" })
    .eq("instance_id", instanceId)
    .eq("job_id", jobId)
    .eq("status", "pending");
  if (delErr) return { ok: false, error: delErr.message };

  // Session-level column mapping proposal.
  const { data: cm, error: cmErr } = await sb
    .from("catalog_suggestion")
    .insert({
      instance_id: instanceId,
      job_id: jobId,
      suggestion_type: "column_mapping",
      source_function: "byo.field_map",
      entity_type: "session",
      confidence: 0.9,
      payload: { mapping, unmapped },
      status: "pending",
    })
    .select("suggestion_id")
    .single();
  if (cmErr) return { ok: false, error: cmErr.message };

  // One variant_structure proposal per grouped product (individually confirmable).
  const productRows = grouped.map((p) => ({
    instance_id: instanceId,
    job_id: jobId,
    suggestion_type: "variant_structure",
    source_function: "byo.group",
    entity_type: "product",
    confidence: Array.isArray(p.variants) && p.variants.length > 0 ? 0.8 : 0.95,
    payload: p,
    status: "pending",
  }));
  if (productRows.length > 0) {
    const { error: insErr } = await sb.from("catalog_suggestion").insert(productRows);
    if (insErr) return { ok: false, error: insErr.message };
  }

  return {
    ok: true,
    result: {
      cleared: cleared ?? 0,
      column_mapping_id: (cm as { suggestion_id: number } | null)?.suggestion_id ?? null,
      product_suggestions: productRows.length,
    },
  };
}

export const DECISIONS = ["accepted", "rejected", "edited"] as const;
export type Decision = (typeof DECISIONS)[number];

export async function decideSuggestions(
  sb: SupabaseClient,
  instanceId: number,
  suggestionIds: number[],
  decision: Decision,
  editorNotes: string | null,
): Promise<{ ok: true; updated: number } | LibError> {
  const { data, error } = await sb
    .from("catalog_suggestion")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      editor_notes: editorNotes,
    })
    .eq("instance_id", instanceId)
    .in("suggestion_id", suggestionIds)
    .select("suggestion_id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, updated: (data ?? []).length };
}
