"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { parseMoney } from "@/lib/pricing/parse-money";
import type { KeyColumnKind } from "@/lib/pricing/column-detect";

/**
 * Discrete server actions for the pricing module. Per CLAUDE.md §14
 * (agent-oriented design) every form action carries a name the future
 * NL-agent panel can call directly.
 */

// =============================================================================
// listProviders — used by the import modal's provider dropdown
// =============================================================================

export type ProviderRow = {
  provider_id: number;
  provider_name: string;
};

export async function listProviders(): Promise<
  | { ok: true; providers: ProviderRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider")
    .select("provider_id, provider_name")
    .eq("is_active", true)
    .order("provider_name", { ascending: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true, providers: data ?? [] };
}

// =============================================================================
// createProvider — used by the modal's "create new" branch
// =============================================================================

export async function createProvider(name: string): Promise<
  | { ok: true; provider: ProviderRow }
  | { ok: false; error: string }
> {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { ok: false, error: "provider_name_too_short" };
  }
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider")
    .insert({ instance_id: instanceId, provider_name: trimmed })
    .select("provider_id, provider_name")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, provider: data };
}

// =============================================================================
// importPriceList — the heart of the wizard
// =============================================================================

export type PriceListImportInput = {
  providerId: number;
  effectiveDate: string | null; // ISO date (YYYY-MM-DD)
  fileName: string;
  keyKind: KeyColumnKind;
  /** Cell values for each row, ordered: [keyValue, costRaw, suggestedPriceRaw?]. */
  rows: Array<[string, string, string | null]>;
};

export type PriceListImportResult = {
  ok: true;
  priceListId: number;
  inserted: number;
  matched: number;
  unmatched: number;
  invalidRows: number;
};

export async function importPriceList(
  input: PriceListImportInput,
): Promise<PriceListImportResult | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();

  // Provider must belong to this instance. RLS will block cross-tenant reads,
  // but we surface a friendlier error than a generic permission failure.
  const { data: provider, error: provErr } = await supabase
    .from("provider")
    .select("provider_id")
    .eq("provider_id", input.providerId)
    .single();
  if (provErr || !provider) {
    return { ok: false, error: "provider_not_found" };
  }

  // Build the variant lookup map for matching. We pull only the column we
  // need based on the chosen key kind. Memory is bounded — even instances
  // with 50k variants are fine.
  const variantLookup = new Map<string, number>();
  if (input.keyKind === "barcode" || input.keyKind === "sku") {
    const column = input.keyKind === "barcode" ? "barcode" : "sku";
    const { data: variants, error: vErr } = await supabase
      .from("product_variant")
      .select(`variant_id, ${column}`)
      .eq("is_active", true);
    if (vErr) return { ok: false, error: vErr.message };
    for (const v of variants ?? []) {
      const key = (v as Record<string, unknown>)[column];
      if (typeof key === "string" && key.trim() !== "") {
        variantLookup.set(key.trim(), v.variant_id as number);
      }
    }
  } else {
    // provider_sku — match against historical price_list_items for the
    // same provider. First-time provider SKU rows will be unmatched.
    const { data: prior, error: pErr } = await supabase
      .from("price_list_item")
      .select("variant_id, provider_sku, price_list:price_list_id(provider_id)")
      .not("provider_sku", "is", null);
    if (pErr) return { ok: false, error: pErr.message };
    type PriorRow = {
      variant_id: number;
      provider_sku: string | null;
      price_list:
        | { provider_id: number }
        | { provider_id: number }[]
        | null;
    };
    for (const row of (prior ?? []) as unknown as PriorRow[]) {
      const pl = Array.isArray(row.price_list)
        ? row.price_list[0]
        : row.price_list;
      if (!pl || pl.provider_id !== input.providerId) continue;
      const sku = row.provider_sku;
      if (sku && !variantLookup.has(sku.trim())) {
        variantLookup.set(sku.trim(), row.variant_id);
      }
    }
  }

  // Create the price_list row up front so all items share its id.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: priceList, error: plErr } = await supabase
    .from("price_list")
    .insert({
      instance_id: instanceId,
      provider_id: input.providerId,
      effective_date: input.effectiveDate,
      file_name: input.fileName,
      imported_by_user_id: user?.id ?? null,
    })
    .select("price_list_id")
    .single();

  if (plErr || !priceList) {
    return { ok: false, error: plErr?.message ?? "price_list_insert_failed" };
  }

  // Walk the rows, parse, attempt to match, build inserts.
  type PendingItem = {
    instance_id: number;
    price_list_id: number;
    variant_id: number;
    cost: number;
    provider_sku: string | null;
    suggested_retail_price: number | null;
  };

  const pending: PendingItem[] = [];
  let unmatched = 0;
  let invalidRows = 0;

  for (const [rawKey, rawCost, rawSuggested] of input.rows) {
    const key = (rawKey ?? "").toString().trim();
    if (key === "") {
      invalidRows++;
      continue;
    }
    const cost = parseMoney(rawCost);
    if (cost === null || cost < 0) {
      invalidRows++;
      continue;
    }
    const variantId = variantLookup.get(key);
    if (variantId === undefined) {
      unmatched++;
      continue;
    }
    pending.push({
      instance_id: instanceId,
      price_list_id: priceList.price_list_id,
      variant_id: variantId,
      cost,
      provider_sku: input.keyKind === "provider_sku" ? key : null,
      suggested_retail_price:
        rawSuggested !== null ? parseMoney(rawSuggested) : null,
    });
  }

  // Deduplicate by variant_id within this list; the unique index would
  // otherwise reject the second occurrence and abort the whole batch.
  const dedupBy = new Map<number, PendingItem>();
  for (const it of pending) dedupBy.set(it.variant_id, it);
  const itemsToInsert = Array.from(dedupBy.values());

  if (itemsToInsert.length > 0) {
    // Insert in chunks to keep the request payload reasonable.
    const CHUNK = 500;
    for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
      const slice = itemsToInsert.slice(i, i + CHUNK);
      const { error: itemErr } = await supabase
        .from("price_list_item")
        .insert(slice);
      if (itemErr) {
        return { ok: false, error: itemErr.message };
      }
    }
  }

  revalidatePath("/pricing");

  return {
    ok: true,
    priceListId: priceList.price_list_id,
    inserted: itemsToInsert.length,
    matched: pending.length,
    unmatched,
    invalidRows,
  };
}
