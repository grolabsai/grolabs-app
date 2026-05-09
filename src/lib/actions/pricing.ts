"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { parseMoney } from "@/lib/pricing/parse-money";
import type { KeyColumnKind } from "@/lib/pricing/column-detect";
import type { CalculationMode } from "@/lib/pricing/calculate";
import type { CharmRule, CharmStrategy } from "@/lib/pricing/charm";
import {
  computeBatchItem,
  type ApplicableMapRule,
} from "@/lib/pricing/compute";

/**
 * Discrete server actions for the pricing module. Per CLAUDE.md §14
 * (agent-oriented design) every form action carries a name the future
 * NL-agent panel can call directly.
 */

// =============================================================================
// Provider CRUD
// =============================================================================

export type ProviderRow = {
  provider_id: number;
  provider_name: string;
};

/** Full provider record returned by the detail screen and grid card. */
export type ProviderDetail = {
  provider_id: number;
  provider_name: string;
  legal_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  payment_terms: string | null;
  default_currency: string | null;
  consignment: boolean;
  notes: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Editable subset — `is_active` and identity stay in saveProvider. */
export type ProviderInput = {
  provider_name: string;
  legal_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  payment_terms: string | null;
  default_currency: string | null;
  consignment: boolean;
  notes: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  is_active: boolean;
};

const PROVIDER_DETAIL_COLUMNS = `
  provider_id, provider_name, legal_name, tax_id,
  contact_name, email, phone, website,
  address_line, city, country,
  payment_terms, default_currency, consignment, notes,
  bank_name, bank_account_number,
  is_active, created_at, updated_at
` as const;

/**
 * List providers visible on the provider grid. Returns active and inactive
 * rows so the UI can show a "ver inactivos" toggle later. Sorted by name.
 */
export async function listProviders(): Promise<
  | { ok: true; providers: ProviderDetail[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider")
    .select(PROVIDER_DETAIL_COLUMNS)
    .order("provider_name", { ascending: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true, providers: (data ?? []) as ProviderDetail[] };
}

/** Used by the import dialog dropdown — only active providers, minimal cols. */
export async function listActiveProvidersBrief(): Promise<
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

/** Fetch one provider by id. RLS scopes to current instance. */
export async function getProvider(providerId: number): Promise<
  | { ok: true; provider: ProviderDetail }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider")
    .select(PROVIDER_DETAIL_COLUMNS)
    .eq("provider_id", providerId)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, provider: data as ProviderDetail };
}

/**
 * Lightweight create used by the import wizard's inline "+ Nuevo proveedor"
 * branch. The full-page form goes through saveProvider instead.
 */
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

/**
 * Save a provider — creates when `providerId` is null, updates otherwise.
 * `provider_name` is the only required field; the rest are optional and
 * trimmed-then-nulled empty strings on save.
 */
export async function saveProvider(
  providerId: number | null,
  input: ProviderInput,
): Promise<
  | { ok: true; providerId: number }
  | { ok: false; error: string }
> {
  const name = input.provider_name.trim();
  if (name.length < 2) return { ok: false, error: "provider_name_too_short" };

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  // Normalise empty strings to null to keep the DB clean.
  const blank = (v: string | null) =>
    v === null || v.trim() === "" ? null : v.trim();

  const payload = {
    provider_name: name,
    legal_name: blank(input.legal_name),
    tax_id: blank(input.tax_id),
    contact_name: blank(input.contact_name),
    email: blank(input.email),
    phone: blank(input.phone),
    website: blank(input.website),
    address_line: blank(input.address_line),
    city: blank(input.city),
    country: blank(input.country),
    payment_terms: blank(input.payment_terms),
    default_currency: blank(input.default_currency),
    consignment: input.consignment,
    notes: blank(input.notes),
    bank_name: blank(input.bank_name),
    bank_account_number: blank(input.bank_account_number),
    is_active: input.is_active,
  };

  const supabase = await createClient();
  if (providerId === null) {
    const { data, error } = await supabase
      .from("provider")
      .insert({ instance_id: instanceId, ...payload })
      .select("provider_id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/providers");
    return { ok: true, providerId: data.provider_id };
  } else {
    const { error } = await supabase
      .from("provider")
      .update(payload)
      .eq("provider_id", providerId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/providers");
    revalidatePath(`/pricing/providers/${providerId}`);
    return { ok: true, providerId };
  }
}

/** Soft toggle — deactivates rather than deletes to keep audit trail. */
export async function setProviderActive(
  providerId: number,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("provider")
    .update({ is_active: isActive })
    .eq("provider_id", providerId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing/providers");
  return { ok: true };
}

// =============================================================================
// Provider ↔ Brand wiring
// =============================================================================

export type BrandRow = {
  brand_id: number;
  brand_name: string;
};

/** Brands currently linked to a provider (active links only). */
export async function listProviderBrands(providerId: number): Promise<
  | { ok: true; brandIds: number[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider_brand")
    .select("brand_id")
    .eq("provider_id", providerId)
    .eq("is_active", true);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    brandIds: (data ?? []).map((r) => r.brand_id as number),
  };
}

/**
 * Replace the provider's brand set. Existing rows for brands that are no
 * longer in the new set get `is_active = false` (not deleted, so we can
 * audit who used to distribute what). Brands newly added get inserted or
 * reactivated.
 */
export async function setProviderBrands(
  providerId: number,
  brandIds: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();

  // Pull current rows so we know which to deactivate vs upsert.
  const { data: current, error: curErr } = await supabase
    .from("provider_brand")
    .select("brand_id, is_active")
    .eq("provider_id", providerId);
  if (curErr) return { ok: false, error: curErr.message };

  const currentMap = new Map<number, boolean>();
  for (const r of current ?? []) {
    currentMap.set(r.brand_id as number, r.is_active as boolean);
  }
  const desired = new Set(brandIds);

  const toDeactivate: number[] = [];
  const toUpsert: Array<{
    instance_id: number;
    provider_id: number;
    brand_id: number;
    is_active: boolean;
  }> = [];

  for (const [bid, active] of currentMap) {
    if (!desired.has(bid) && active) toDeactivate.push(bid);
  }
  for (const bid of desired) {
    const wasActive = currentMap.get(bid);
    if (wasActive === undefined) {
      toUpsert.push({
        instance_id: instanceId,
        provider_id: providerId,
        brand_id: bid,
        is_active: true,
      });
    } else if (wasActive === false) {
      toUpsert.push({
        instance_id: instanceId,
        provider_id: providerId,
        brand_id: bid,
        is_active: true,
      });
    }
  }

  if (toDeactivate.length > 0) {
    const { error } = await supabase
      .from("provider_brand")
      .update({ is_active: false })
      .eq("provider_id", providerId)
      .in("brand_id", toDeactivate);
    if (error) return { ok: false, error: error.message };
  }
  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("provider_brand")
      .upsert(toUpsert, { onConflict: "provider_id,brand_id" });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/pricing/providers/${providerId}`);
  return { ok: true };
}

/** All brands belonging to the current instance — feeds the chip picker. */
export async function listBrandsForPricing(): Promise<
  | { ok: true; brands: BrandRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand")
    .select("brand_id, brand_name")
    .order("brand_name", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, brands: data ?? [] };
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

// =============================================================================
// Pricing config (instance.pricing_config jsonb)
// =============================================================================

export type PricingConfig = {
  calculation_mode: CalculationMode;
  default_target_pct: number;
  default_min_pct: number;
  /**
   * When true, worksheet rows whose |new_price − current_price| / current_price
   * exceeds `max_price_change_pct` get flagged as a warning. Compares against
   * the variant's current selling price, not the previous batch's final price.
   */
  max_price_change_enabled: boolean;
  max_price_change_pct: number;
};

const PRICING_CONFIG_DEFAULTS: PricingConfig = {
  calculation_mode: "margin",
  default_target_pct: 40,
  default_min_pct: 20,
  // Off by default so a fresh instance doesn't fire warnings on its first
  // import before the user has had a chance to opt in.
  max_price_change_enabled: false,
  max_price_change_pct: 5,
};

/**
 * Read the current instance's pricing config, falling back to defaults
 * for any keys that haven't been written yet. Always returns a complete
 * `PricingConfig` so callers don't have to worry about partial state.
 */
export async function getPricingConfig(): Promise<
  | { ok: true; config: PricingConfig }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instance")
    .select("pricing_config")
    .eq("instance_id", instanceId)
    .single();
  if (error) return { ok: false, error: error.message };

  const raw = (data?.pricing_config ?? {}) as Partial<PricingConfig>;
  const mode: CalculationMode =
    raw.calculation_mode === "markup" ? "markup" : "margin";
  return {
    ok: true,
    config: {
      calculation_mode: mode,
      default_target_pct:
        typeof raw.default_target_pct === "number"
          ? raw.default_target_pct
          : PRICING_CONFIG_DEFAULTS.default_target_pct,
      default_min_pct:
        typeof raw.default_min_pct === "number"
          ? raw.default_min_pct
          : PRICING_CONFIG_DEFAULTS.default_min_pct,
      max_price_change_enabled:
        typeof raw.max_price_change_enabled === "boolean"
          ? raw.max_price_change_enabled
          : PRICING_CONFIG_DEFAULTS.max_price_change_enabled,
      max_price_change_pct:
        typeof raw.max_price_change_pct === "number"
          ? raw.max_price_change_pct
          : PRICING_CONFIG_DEFAULTS.max_price_change_pct,
    },
  };
}

export async function savePricingConfig(
  next: PricingConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (next.calculation_mode !== "margin" && next.calculation_mode !== "markup") {
    return { ok: false, error: "invalid_mode" };
  }
  if (
    !Number.isFinite(next.default_target_pct) ||
    !Number.isFinite(next.default_min_pct)
  ) {
    return { ok: false, error: "invalid_defaults" };
  }
  // Margin mode caps at 99.99 (100% would mean infinite price); markup has
  // no hard upper limit but we cap at 1000% just to catch obvious typos.
  const maxPct = next.calculation_mode === "margin" ? 99.99 : 1000;
  if (
    next.default_target_pct < 0 ||
    next.default_target_pct > maxPct ||
    next.default_min_pct < 0 ||
    next.default_min_pct > maxPct
  ) {
    return { ok: false, error: "pct_out_of_range" };
  }
  if (next.default_min_pct > next.default_target_pct) {
    return { ok: false, error: "min_above_target" };
  }
  if (typeof next.max_price_change_enabled !== "boolean") {
    return { ok: false, error: "invalid_max_change_flag" };
  }
  if (
    !Number.isFinite(next.max_price_change_pct) ||
    next.max_price_change_pct < 0 ||
    next.max_price_change_pct > 1000
  ) {
    return { ok: false, error: "invalid_max_change_pct" };
  }

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("instance")
    .update({ pricing_config: next })
    .eq("instance_id", instanceId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/pricing/policies");
  revalidatePath("/pricing");
  return { ok: true };
}

// =============================================================================
// Charm rules CRUD
// =============================================================================

export type CharmRuleRow = {
  charm_rule_id: number;
  min_price: number;
  max_price: number | null;
  strategy: CharmStrategy;
  strategy_value: number;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
};

export type CharmRuleInput = {
  charm_rule_id: number | null; // null = create
  min_price: number;
  max_price: number | null;
  strategy: CharmStrategy;
  strategy_value: number;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
};

export async function listCharmRules(): Promise<
  | { ok: true; rules: CharmRuleRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("charm_rule")
    .select(
      "charm_rule_id, min_price, max_price, strategy, strategy_value, is_active, sort_order, notes",
    )
    .order("sort_order", { ascending: true })
    .order("charm_rule_id", { ascending: true });
  if (error) return { ok: false, error: error.message };

  // Postgres numeric arrives as a string; coerce to number for the UI.
  const rules: CharmRuleRow[] = (data ?? []).map((r) => ({
    charm_rule_id: r.charm_rule_id as number,
    min_price: Number(r.min_price),
    max_price: r.max_price === null ? null : Number(r.max_price),
    strategy: r.strategy as CharmStrategy,
    strategy_value: Number(r.strategy_value),
    is_active: r.is_active as boolean,
    sort_order: r.sort_order as number,
    notes: r.notes as string | null,
  }));
  return { ok: true, rules };
}

export async function saveCharmRule(
  input: CharmRuleInput,
): Promise<
  | { ok: true; charmRuleId: number }
  | { ok: false; error: string }
> {
  if (!Number.isFinite(input.min_price) || input.min_price < 0) {
    return { ok: false, error: "invalid_min_price" };
  }
  if (
    input.max_price !== null &&
    (!Number.isFinite(input.max_price) || input.max_price < input.min_price)
  ) {
    return { ok: false, error: "invalid_max_price" };
  }
  if (
    input.strategy !== "ends_in" &&
    input.strategy !== "round_to" &&
    input.strategy !== "fixed_offset"
  ) {
    return { ok: false, error: "invalid_strategy" };
  }
  if (!Number.isFinite(input.strategy_value) || input.strategy_value < 0) {
    return { ok: false, error: "invalid_strategy_value" };
  }

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const payload = {
    min_price: input.min_price,
    max_price: input.max_price,
    strategy: input.strategy,
    strategy_value: input.strategy_value,
    is_active: input.is_active,
    sort_order: input.sort_order,
    notes: input.notes,
  };

  const supabase = await createClient();
  if (input.charm_rule_id === null) {
    const { data, error } = await supabase
      .from("charm_rule")
      .insert({ instance_id: instanceId, ...payload })
      .select("charm_rule_id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/policies");
    return { ok: true, charmRuleId: data.charm_rule_id };
  } else {
    const { error } = await supabase
      .from("charm_rule")
      .update(payload)
      .eq("charm_rule_id", input.charm_rule_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/policies");
    return { ok: true, charmRuleId: input.charm_rule_id };
  }
}

export async function deleteCharmRule(
  charmRuleId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("charm_rule")
    .delete()
    .eq("charm_rule_id", charmRuleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing/policies");
  return { ok: true };
}

// =============================================================================
// Per-category margins (target / min)
// =============================================================================

export type CategoryMarginRow = {
  category_id: number;
  parent_category_id: number | null;
  level: number;
  category_name: string;
  /** Indent depth in the rendered tree — root = 0. */
  depth: number;
  /** Own (explicitly set) values, or null if the column is unset. */
  own_target_margin: number | null;
  own_min_margin: number | null;
  /** Resolved values — own → ancestor → instance default. Always present. */
  resolved_target_pct: number;
  resolved_min_pct: number;
  /** Per-field provenance so the UI can italicise inherited / default values. */
  target_source: "own" | "inherited" | "default";
  min_source: "own" | "inherited" | "default";
};

type CategoryRowRaw = {
  category_id: number;
  parent_category_id: number | null;
  level: number;
  sort_order: number | null;
  category_name: string;
  target_margin: number | string | null;
  min_margin: number | string | null;
};

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * List all categories in the current instance, in tree (depth-first) order,
 * with each row's resolved target/min margin. The resolver walks ancestors;
 * if no ancestor has a value either, falls back to instance defaults from
 * pricing_config.
 *
 * Returned shape is flat — siblings are grouped under their parent in the
 * order parents appear, so the UI can render straight rows with indent
 * styling instead of recursing.
 */
export async function listCategoryMargins(): Promise<
  | { ok: true; rows: CategoryMarginRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  // Pull defaults — they're the bottom-of-the-stack fallback per category.
  const cfgRes = await getPricingConfig();
  if (!cfgRes.ok) return { ok: false, error: cfgRes.error };
  const defaults = {
    target: cfgRes.config.default_target_pct,
    min: cfgRes.config.default_min_pct,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category")
    .select(
      "category_id, parent_category_id, level, sort_order, category_name, target_margin, min_margin",
    )
    .eq("is_active", true);
  if (error) return { ok: false, error: error.message };

  const raw: CategoryRowRaw[] = (data ?? []) as CategoryRowRaw[];

  // Build adjacency for tree walk and a row map for ancestor resolution.
  const byParent = new Map<number | null, CategoryRowRaw[]>();
  const byId = new Map<number, CategoryRowRaw>();
  for (const r of raw) {
    byId.set(r.category_id, r);
    const list = byParent.get(r.parent_category_id) ?? [];
    list.push(r);
    byParent.set(r.parent_category_id, list);
  }
  // Sort each sibling group alphabetically (sort_order tiebreaker first).
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      const so = (a.sort_order ?? 999_999) - (b.sort_order ?? 999_999);
      if (so !== 0) return so;
      return a.category_name.localeCompare(b.category_name, "es");
    });
  }

  /** Resolve a single field by walking up the ancestor chain. */
  function resolveField(
    startId: number,
    pick: "target_margin" | "min_margin",
    fallback: number,
  ): { value: number; source: "own" | "inherited" | "default" } {
    const start = byId.get(startId);
    if (!start) return { value: fallback, source: "default" };
    const own = num(start[pick]);
    if (own !== null) return { value: own, source: "own" };
    let cursor = start.parent_category_id;
    while (cursor !== null) {
      const parent = byId.get(cursor);
      if (!parent) break;
      const v = num(parent[pick]);
      if (v !== null) return { value: v, source: "inherited" };
      cursor = parent.parent_category_id;
    }
    return { value: fallback, source: "default" };
  }

  const out: CategoryMarginRow[] = [];

  function visit(node: CategoryRowRaw, depth: number) {
    const target = resolveField(node.category_id, "target_margin", defaults.target);
    const min = resolveField(node.category_id, "min_margin", defaults.min);
    out.push({
      category_id: node.category_id,
      parent_category_id: node.parent_category_id,
      level: node.level,
      category_name: node.category_name,
      depth,
      own_target_margin: num(node.target_margin),
      own_min_margin: num(node.min_margin),
      resolved_target_pct: target.value,
      resolved_min_pct: min.value,
      target_source: target.source,
      min_source: min.source,
    });
    const children = byParent.get(node.category_id) ?? [];
    for (const child of children) visit(child, depth + 1);
  }

  const roots = byParent.get(null) ?? [];
  for (const root of roots) visit(root, 0);

  return { ok: true, rows: out };
}

// =============================================================================
// MAP rules CRUD
// =============================================================================

export type MapRuleType = "MAP_min" | "max_price" | "custom";
export type MapRuleSourceType = "brand" | "provider";

/** Row shape used by the rules table — joins the source name + variant name. */
export type MapRuleRow = {
  map_rule_id: number;
  rule_type: MapRuleType;
  source_type: MapRuleSourceType;
  source_id: number;
  source_name: string; // resolved from brand or provider
  variant_id: number | null;
  variant_label: string | null; // resolved variant_name + sku, or null when applies-to-all
  min_price: number | null;
  max_price: number | null;
  is_active: boolean;
  effective_date: string;
  expires_at: string | null;
  notes: string | null;
};

export type MapRuleInput = {
  map_rule_id: number | null; // null = create
  rule_type: MapRuleType;
  source_type: MapRuleSourceType;
  source_id: number;
  variant_id: number | null;
  min_price: number | null;
  max_price: number | null;
  is_active: boolean;
  effective_date: string; // YYYY-MM-DD
  expires_at: string | null;
  notes: string | null;
};

export async function listMapRules(): Promise<
  | { ok: true; rules: MapRuleRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("map_rule")
    .select(
      "map_rule_id, rule_type, source_type, source_id, variant_id, min_price, max_price, is_active, effective_date, expires_at, notes",
    )
    .order("is_active", { ascending: false })
    .order("effective_date", { ascending: false })
    .order("map_rule_id", { ascending: false });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<{
    map_rule_id: number;
    rule_type: MapRuleType;
    source_type: MapRuleSourceType;
    source_id: number;
    variant_id: number | null;
    min_price: number | string | null;
    max_price: number | string | null;
    is_active: boolean;
    effective_date: string;
    expires_at: string | null;
    notes: string | null;
  }>;

  // Resolve names in two batched lookups (brand and provider) plus one for
  // variants. Doing N+1 here would scale poorly once the table has dozens
  // of rules.
  const brandIds = new Set<number>();
  const providerIds = new Set<number>();
  const variantIds = new Set<number>();
  for (const r of rows) {
    if (r.source_type === "brand") brandIds.add(r.source_id);
    if (r.source_type === "provider") providerIds.add(r.source_id);
    if (r.variant_id !== null) variantIds.add(r.variant_id);
  }

  const [brandData, providerData, variantData] = await Promise.all([
    brandIds.size > 0
      ? supabase
          .from("brand")
          .select("brand_id, brand_name")
          .in("brand_id", Array.from(brandIds))
      : Promise.resolve({ data: [] as Array<{ brand_id: number; brand_name: string }>, error: null }),
    providerIds.size > 0
      ? supabase
          .from("provider")
          .select("provider_id, provider_name")
          .in("provider_id", Array.from(providerIds))
      : Promise.resolve({ data: [] as Array<{ provider_id: number; provider_name: string }>, error: null }),
    variantIds.size > 0
      ? supabase
          .from("product_variant")
          .select("variant_id, variant_name, sku")
          .in("variant_id", Array.from(variantIds))
      : Promise.resolve({
          data: [] as Array<{ variant_id: number; variant_name: string | null; sku: string | null }>,
          error: null,
        }),
  ]);

  const brandMap = new Map(
    (brandData.data ?? []).map((b) => [b.brand_id, b.brand_name]),
  );
  const providerMap = new Map(
    (providerData.data ?? []).map((p) => [p.provider_id, p.provider_name]),
  );
  const variantMap = new Map(
    (variantData.data ?? []).map((v) => {
      const label =
        [v.variant_name, v.sku].filter((s) => s && String(s).trim() !== "").join(" · ") ||
        `#${v.variant_id}`;
      return [v.variant_id, label];
    }),
  );

  const rules: MapRuleRow[] = rows.map((r) => ({
    map_rule_id: r.map_rule_id,
    rule_type: r.rule_type,
    source_type: r.source_type,
    source_id: r.source_id,
    source_name:
      r.source_type === "brand"
        ? brandMap.get(r.source_id) ?? `#${r.source_id}`
        : providerMap.get(r.source_id) ?? `#${r.source_id}`,
    variant_id: r.variant_id,
    variant_label:
      r.variant_id === null ? null : variantMap.get(r.variant_id) ?? `#${r.variant_id}`,
    min_price: r.min_price === null ? null : Number(r.min_price),
    max_price: r.max_price === null ? null : Number(r.max_price),
    is_active: r.is_active,
    effective_date: r.effective_date,
    expires_at: r.expires_at,
    notes: r.notes,
  }));

  return { ok: true, rules };
}

export async function saveMapRule(
  input: MapRuleInput,
): Promise<
  | { ok: true; mapRuleId: number }
  | { ok: false; error: string }
> {
  if (
    input.rule_type !== "MAP_min" &&
    input.rule_type !== "max_price" &&
    input.rule_type !== "custom"
  ) {
    return { ok: false, error: "invalid_rule_type" };
  }
  if (input.source_type !== "brand" && input.source_type !== "provider") {
    return { ok: false, error: "invalid_source_type" };
  }
  if (!Number.isFinite(input.source_id) || input.source_id <= 0) {
    return { ok: false, error: "invalid_source_id" };
  }
  if (input.min_price === null && input.max_price === null) {
    return { ok: false, error: "no_price_set" };
  }
  if (
    input.min_price !== null &&
    (!Number.isFinite(input.min_price) || input.min_price < 0)
  ) {
    return { ok: false, error: "invalid_min_price" };
  }
  if (
    input.max_price !== null &&
    (!Number.isFinite(input.max_price) || input.max_price < 0)
  ) {
    return { ok: false, error: "invalid_max_price" };
  }
  if (
    input.min_price !== null &&
    input.max_price !== null &&
    input.min_price > input.max_price
  ) {
    return { ok: false, error: "min_above_max" };
  }

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const payload = {
    rule_type: input.rule_type,
    source_type: input.source_type,
    source_id: input.source_id,
    variant_id: input.variant_id,
    min_price: input.min_price,
    max_price: input.max_price,
    is_active: input.is_active,
    effective_date: input.effective_date,
    expires_at: input.expires_at,
    notes: input.notes,
  };

  const supabase = await createClient();
  if (input.map_rule_id === null) {
    const { data, error } = await supabase
      .from("map_rule")
      .insert({ instance_id: instanceId, ...payload })
      .select("map_rule_id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/violations");
    return { ok: true, mapRuleId: data.map_rule_id };
  } else {
    const { error } = await supabase
      .from("map_rule")
      .update(payload)
      .eq("map_rule_id", input.map_rule_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/pricing/violations");
    return { ok: true, mapRuleId: input.map_rule_id };
  }
}

export async function deleteMapRule(
  mapRuleId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("map_rule")
    .delete()
    .eq("map_rule_id", mapRuleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing/violations");
  return { ok: true };
}

/**
 * Search variants for the MAP rule's "specific variant" picker.
 * - Caps the result at 50 to keep payloads small.
 * - Requires a 2-char query so we never return the whole catalog.
 * - Searches by variant name OR SKU OR barcode (ilike).
 * - When source_type='brand', filters to product.brand_id = source_id so
 *   the picker only surfaces the brand's variants. For provider source
 *   we skip the filter — variants aren't tied to a single provider.
 */
export type VariantSearchResult = {
  variant_id: number;
  label: string;
  sku: string | null;
  brand_id: number | null;
};

export async function searchVariantsForMapRule(
  query: string,
  sourceType: MapRuleSourceType,
  sourceId: number | null,
): Promise<
  | { ok: true; variants: VariantSearchResult[] }
  | { ok: false; error: string }
> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, variants: [] };

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  // The Supabase JS client doesn't support a single OR across nested fields
  // cleanly; build a tilde-friendly pattern + multiple matches via .or().
  const pattern = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;
  let qb = supabase
    .from("product_variant")
    .select("variant_id, variant_name, sku, barcode, product_id, product:product_id(brand_id, product_name)")
    .eq("is_active", true)
    .or(`variant_name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`)
    .limit(50);

  const { data, error } = await qb;
  if (error) return { ok: false, error: error.message };

  type Row = {
    variant_id: number;
    variant_name: string | null;
    sku: string | null;
    barcode: string | null;
    product_id: number | null;
    product:
      | { brand_id: number | null; product_name: string | null }
      | { brand_id: number | null; product_name: string | null }[]
      | null;
  };

  let rows = (data ?? []) as unknown as Row[];

  // Apply the brand filter client-side after the query — Supabase doesn't
  // let us filter on a related field cleanly inside .or(), and 50 rows is
  // small enough that a JS pass is fine.
  if (sourceType === "brand" && sourceId !== null) {
    rows = rows.filter((r) => {
      const product = Array.isArray(r.product) ? r.product[0] : r.product;
      return product?.brand_id === sourceId;
    });
  }

  const variants: VariantSearchResult[] = rows.map((r) => {
    const product = Array.isArray(r.product) ? r.product[0] : r.product;
    const productName = product?.product_name ?? "";
    const variantName = r.variant_name ?? "";
    const composed = [productName, variantName]
      .filter((s) => s && s.trim() !== "")
      .join(" · ");
    const labelBase = composed || `#${r.variant_id}`;
    const labelWithSku = r.sku ? `${labelBase} · ${r.sku}` : labelBase;
    return {
      variant_id: r.variant_id,
      label: labelWithSku,
      sku: r.sku,
      brand_id: product?.brand_id ?? null,
    };
  });

  return { ok: true, variants };
}

/**
 * Update a category's own target_margin and min_margin. Pass `null` for
 * either field to inherit from the ancestor chain. The single-toggle UI
 * passes (null, null) to "inherit both".
 */
export async function saveCategoryMargin(
  categoryId: number,
  target: number | null,
  min: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (target !== null && (!Number.isFinite(target) || target < 0)) {
    return { ok: false, error: "invalid_target" };
  }
  if (min !== null && (!Number.isFinite(min) || min < 0)) {
    return { ok: false, error: "invalid_min" };
  }
  if (target !== null && min !== null && min > target) {
    return { ok: false, error: "min_above_target" };
  }

  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category")
    .update({ target_margin: target, min_margin: min })
    .eq("category_id", categoryId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/pricing/policies");
  return { ok: true };
}

// =============================================================================
// Price batches — list, create-from-price-list, detail
// =============================================================================

export type PriceBatchStatus = "draft" | "ready" | "synced";

export type BatchListRow = {
  price_batch_id: number;
  batch_name: string;
  status: PriceBatchStatus;
  item_count: number;
  warning_count: number;
  critical_count: number;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
};

export type PendingPriceListRow = {
  price_list_id: number;
  provider_id: number;
  provider_name: string;
  file_name: string | null;
  import_date: string;
  effective_date: string | null;
  item_count: number;
};

export type BatchDetailItem = {
  price_batch_item_id: number;
  variant_id: number;
  variant_label: string;
  brand_name: string | null;
  provider_name: string | null;
  current_cost: number | null;
  new_cost: number | null;
  current_price: number | null;
  charm_price: number | null;
  final_price: number | null;
  manual_override: boolean;
  margin_percent: number | null;
  status: "neutral" | "warning" | "critical";
  status_reasons: string[];
};

export type BatchDetail = {
  price_batch_id: number;
  batch_name: string;
  status: PriceBatchStatus;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  item_count: number;
  neutral_count: number;
  warning_count: number;
  critical_count: number;
  items: BatchDetailItem[];
};

/**
 * Recent batches for `/pricing/changes`. Sorted by updated_at desc.
 * The status counts are computed in JS from the embedded items so a
 * single round-trip covers the table.
 */
export async function listBatches(): Promise<
  | { ok: true; batches: BatchListRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_batch")
    .select(
      "price_batch_id, batch_name, status, created_at, updated_at, synced_at, price_batch_item(price_batch_item_id, status)",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: error.message };

  const batches: BatchListRow[] = (data ?? []).map((b) => {
    const items = (b.price_batch_item ?? []) as Array<{
      price_batch_item_id: number;
      status: "neutral" | "warning" | "critical";
    }>;
    return {
      price_batch_id: b.price_batch_id as number,
      batch_name: b.batch_name as string,
      status: b.status as PriceBatchStatus,
      item_count: items.length,
      warning_count: items.filter((i) => i.status === "warning").length,
      critical_count: items.filter((i) => i.status === "critical").length,
      created_at: b.created_at as string,
      updated_at: b.updated_at as string,
      synced_at: (b.synced_at as string | null) ?? null,
    };
  });

  return { ok: true, batches };
}

/**
 * Price lists that have at least one matched item but no batch yet —
 * candidates for the "Crear lote" button. We can't easily express
 * "price lists with no associated batch" purely in SQL because there's
 * no FK from price_batch back to price_list (a batch is a calculation
 * snapshot, not a child of one list). For v1 we surface every recent
 * price list and rely on the user to decide which to convert.
 */
export async function listPendingPriceLists(): Promise<
  | { ok: true; lists: PendingPriceListRow[] }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_list")
    .select(
      "price_list_id, provider_id, file_name, import_date, effective_date, price_list_item(price_list_item_id)",
    )
    .order("import_date", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };

  const providerIds = Array.from(
    new Set((data ?? []).map((r) => r.provider_id as number)),
  );
  const { data: providerData } =
    providerIds.length > 0
      ? await supabase
          .from("provider")
          .select("provider_id, provider_name")
          .in("provider_id", providerIds)
      : { data: [] };
  const providerMap = new Map(
    (providerData ?? []).map((p) => [p.provider_id, p.provider_name]),
  );

  const lists: PendingPriceListRow[] = (data ?? []).map((r) => {
    const items = (r.price_list_item ?? []) as Array<{
      price_list_item_id: number;
    }>;
    return {
      price_list_id: r.price_list_id as number,
      provider_id: r.provider_id as number,
      provider_name:
        providerMap.get(r.provider_id as number) ?? `#${r.provider_id}`,
      file_name: (r.file_name as string | null) ?? null,
      import_date: r.import_date as string,
      effective_date: (r.effective_date as string | null) ?? null,
      item_count: items.length,
    };
  });

  return { ok: true, lists };
}

/**
 * Create a new price batch from a price list. Walks every matched
 * price_list_item, runs the compute engine, and bulk-inserts the rows.
 * Returns the new batch_id so the caller can redirect.
 *
 * V1 simplifications:
 *   - One batch = one price list = one provider.
 *   - current_price comes from the most recent SYNCED batch's
 *     final_price for the same variant, or null.
 *   - Variants without a primary category fall back to instance
 *     defaults (handled by listCategoryMargins's resolver).
 */
export async function createBatchFromPriceList(
  priceListId: number,
  batchName: string | null,
): Promise<
  | { ok: true; priceBatchId: number }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();

  // 1. Validate the price list and pull its provider so we can filter
  //    provider-scoped MAP rules later.
  const { data: priceList, error: plErr } = await supabase
    .from("price_list")
    .select("price_list_id, provider_id, import_date, file_name")
    .eq("price_list_id", priceListId)
    .single();
  if (plErr || !priceList) {
    return { ok: false, error: plErr?.message ?? "price_list_not_found" };
  }
  const providerId = priceList.provider_id as number;

  // 2. Pull every cost row for this list.
  const { data: itemsRaw, error: itemsErr } = await supabase
    .from("price_list_item")
    .select(
      "price_list_item_id, variant_id, cost, suggested_retail_price, provider_sku",
    )
    .eq("price_list_id", priceListId);
  if (itemsErr) return { ok: false, error: itemsErr.message };
  const items = (itemsRaw ?? []) as Array<{
    price_list_item_id: number;
    variant_id: number;
    cost: number | string;
    suggested_retail_price: number | string | null;
    provider_sku: string | null;
  }>;
  if (items.length === 0) {
    return { ok: false, error: "no_items_in_list" };
  }

  // 3. Bulk-load every dependency in parallel.
  const variantIds = items.map((i) => i.variant_id);
  const [
    cfgRes,
    marginRowsRes,
    charmRulesRes,
    mapRulesRaw,
    variantRows,
    currentPriceRows,
  ] = await Promise.all([
    getPricingConfig(),
    listCategoryMargins(),
    supabase
      .from("charm_rule")
      .select(
        "charm_rule_id, min_price, max_price, strategy, strategy_value, is_active, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("charm_rule_id", { ascending: true }),
    supabase
      .from("map_rule")
      .select(
        "rule_type, source_type, source_id, variant_id, min_price, max_price, is_active, effective_date, expires_at",
      )
      .eq("is_active", true),
    supabase
      .from("product_variant")
      .select("variant_id, product_id, variant_name, sku")
      .in("variant_id", variantIds),
    // Latest synced price for the current_price column. Empty until
    // anything actually syncs — fine for v1.
    supabase
      .from("price_batch_item")
      .select(
        "variant_id, final_price, price_batch:price_batch_id!inner(status, synced_at)",
      )
      .in("variant_id", variantIds)
      .eq("price_batch.status", "synced")
      .order("price_batch(synced_at)", { ascending: false }),
  ]);

  if (!cfgRes.ok) return { ok: false, error: cfgRes.error };
  if (!marginRowsRes.ok) return { ok: false, error: marginRowsRes.error };
  if (charmRulesRes.error) return { ok: false, error: charmRulesRes.error.message };
  if (mapRulesRaw.error) return { ok: false, error: mapRulesRaw.error.message };
  if (variantRows.error) return { ok: false, error: variantRows.error.message };
  if (currentPriceRows.error)
    return { ok: false, error: currentPriceRows.error.message };

  const config = cfgRes.config;
  const charmRules: CharmRule[] = (charmRulesRes.data ?? []).map((r) => ({
    charm_rule_id: r.charm_rule_id as number,
    min_price: Number(r.min_price),
    max_price: r.max_price === null ? null : Number(r.max_price),
    strategy: r.strategy as CharmRule["strategy"],
    strategy_value: Number(r.strategy_value),
    is_active: r.is_active as boolean,
    sort_order: r.sort_order as number,
  }));

  // 4. Resolve variant → product → primary category in one go.
  const productIds = Array.from(
    new Set(
      (variantRows.data ?? [])
        .map((v) => (v as { product_id: number | null }).product_id)
        .filter((id): id is number => id !== null),
    ),
  );
  const [productRows, primaryLinkRows] = await Promise.all([
    productIds.length > 0
      ? supabase
          .from("product")
          .select("product_id, brand_id, product_name")
          .in("product_id", productIds)
      : Promise.resolve({
          data: [] as Array<{
            product_id: number;
            brand_id: number | null;
            product_name: string | null;
          }>,
          error: null,
        }),
    productIds.length > 0
      ? supabase
          .from("product_category_link")
          .select("product_id, category_id, is_primary")
          .in("product_id", productIds)
          .eq("is_primary", true)
      : Promise.resolve({
          data: [] as Array<{
            product_id: number;
            category_id: number;
            is_primary: boolean;
          }>,
          error: null,
        }),
  ]);

  const productMap = new Map<
    number,
    { brand_id: number | null; product_name: string | null }
  >();
  for (const p of productRows.data ?? []) {
    productMap.set(p.product_id as number, {
      brand_id: (p as { brand_id: number | null }).brand_id,
      product_name: (p as { product_name: string | null }).product_name,
    });
  }
  const primaryCategoryByProduct = new Map<number, number>();
  for (const link of primaryLinkRows.data ?? []) {
    primaryCategoryByProduct.set(
      link.product_id as number,
      link.category_id as number,
    );
  }

  // Margins by category_id for fast lookup.
  const marginByCategory = new Map(
    marginRowsRes.rows.map((r) => [
      r.category_id,
      { target: r.resolved_target_pct, min: r.resolved_min_pct },
    ]),
  );
  const fallbackMargins = {
    target: config.default_target_pct,
    min: config.default_min_pct,
  };

  // current_price by variant_id (first row per variant wins because we
  // ordered by synced_at desc above).
  const currentPriceByVariant = new Map<number, number>();
  for (const r of currentPriceRows.data ?? []) {
    const vid = (r as { variant_id: number }).variant_id;
    if (currentPriceByVariant.has(vid)) continue;
    const fp = (r as { final_price: number | string | null }).final_price;
    if (fp === null) continue;
    currentPriceByVariant.set(vid, Number(fp));
  }

  // Index variant rows for label assembly.
  const variantById = new Map<
    number,
    { product_id: number | null; variant_name: string | null; sku: string | null }
  >();
  for (const v of variantRows.data ?? []) {
    variantById.set((v as { variant_id: number }).variant_id, {
      product_id: (v as { product_id: number | null }).product_id,
      variant_name: (v as { variant_name: string | null }).variant_name,
      sku: (v as { sku: string | null }).sku,
    });
  }

  // 5. Pre-filter MAP rules to ones that COULD apply on this batch (date
  //    valid + source matches this batch's provider, OR source is a brand).
  const today = new Date().toISOString().slice(0, 10);
  type MapRuleRaw = {
    rule_type: "MAP_min" | "max_price" | "custom";
    source_type: "brand" | "provider";
    source_id: number;
    variant_id: number | null;
    min_price: number | string | null;
    max_price: number | string | null;
    is_active: boolean;
    effective_date: string;
    expires_at: string | null;
  };
  const mapRules: MapRuleRaw[] = (mapRulesRaw.data ?? []) as MapRuleRaw[];
  const dateValidRules = mapRules.filter(
    (r) =>
      r.is_active &&
      r.effective_date <= today &&
      (r.expires_at === null || r.expires_at >= today),
  );

  // 6. Build the insert payloads.
  type Pending = {
    instance_id: number;
    price_batch_id: number; // patched in after the batch insert
    variant_id: number;
    current_cost: number | null;
    new_cost: number;
    current_price: number | null;
    charm_price: number | null;
    final_price: number | null;
    manual_override: boolean;
    margin_percent: number | null;
    status: "neutral" | "warning" | "critical";
    status_reasons: string[];
  };
  const pending: Omit<Pending, "price_batch_id">[] = [];

  for (const item of items) {
    const variant = variantById.get(item.variant_id);
    const productId = variant?.product_id ?? null;
    const product = productId !== null ? productMap.get(productId) : null;
    const brandId = product?.brand_id ?? null;
    const categoryId =
      productId !== null ? primaryCategoryByProduct.get(productId) ?? null : null;
    const margins =
      (categoryId !== null ? marginByCategory.get(categoryId) : null) ??
      fallbackMargins;

    // MAP rules applicable to THIS variant.
    const applicable: ApplicableMapRule[] = dateValidRules
      .filter((r) => {
        if (r.variant_id !== null && r.variant_id !== item.variant_id) {
          return false;
        }
        if (r.source_type === "brand") {
          return brandId !== null && r.source_id === brandId;
        }
        // provider scope: every variant in this batch shares the same
        // provider (priceList.provider_id), so a provider-scoped rule
        // applies if its source_id matches that.
        return r.source_id === providerId;
      })
      .map((r) => ({
        rule_type: r.rule_type,
        min_price: r.min_price === null ? null : Number(r.min_price),
        max_price: r.max_price === null ? null : Number(r.max_price),
      }));

    const cost = Number(item.cost);
    const currentPrice = currentPriceByVariant.get(item.variant_id) ?? null;

    const result = computeBatchItem({
      cost,
      current_price: currentPrice,
      mode: config.calculation_mode,
      category_target_pct: margins.target,
      category_min_pct: margins.min,
      charm_rules: charmRules,
      map_rules: applicable,
      max_price_change_enabled: config.max_price_change_enabled,
      max_price_change_pct: config.max_price_change_pct,
      manual_override_final_price: null,
    });

    pending.push({
      instance_id: instanceId,
      variant_id: item.variant_id,
      current_cost: currentPrice !== null ? null : null, // we don't track historical cost yet; future
      new_cost: cost,
      current_price: currentPrice,
      charm_price: result.charm_price,
      final_price: result.final_price,
      manual_override: false,
      margin_percent: result.margin_percent,
      status: result.status,
      status_reasons: result.status_reasons,
    });
  }

  // 7. Insert the batch row, then attach price_batch_id to every item and
  //    bulk-insert in chunks.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const defaultName =
    batchName?.trim() ||
    `Cambios ${new Date().toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;

  const { data: batchRow, error: batchErr } = await supabase
    .from("price_batch")
    .insert({
      instance_id: instanceId,
      batch_name: defaultName,
      status: "draft",
      created_by_user_id: user?.id ?? null,
    })
    .select("price_batch_id")
    .single();
  if (batchErr || !batchRow) {
    return { ok: false, error: batchErr?.message ?? "batch_insert_failed" };
  }
  const priceBatchId = batchRow.price_batch_id as number;

  const itemsToInsert = pending.map((p) => ({
    ...p,
    price_batch_id: priceBatchId,
  }));

  const CHUNK = 500;
  for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
    const slice = itemsToInsert.slice(i, i + CHUNK);
    const { error: insErr } = await supabase
      .from("price_batch_item")
      .insert(slice);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidatePath("/pricing/changes");
  revalidatePath("/pricing");
  return { ok: true, priceBatchId };
}

/**
 * Detail loader for `/pricing/changes/[batch_id]`. Joins variant, product,
 * brand, and the originating price list's provider so the items table can
 * render "Producto · Marca (Proveedor)" without N+1.
 */
export async function getBatchDetail(batchId: number): Promise<
  | { ok: true; batch: BatchDetail }
  | { ok: false; error: string }
> {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { ok: false, error: "no_instance" };

  const supabase = await createClient();
  const { data: batch, error: batchErr } = await supabase
    .from("price_batch")
    .select(
      "price_batch_id, batch_name, status, created_at, updated_at, synced_at",
    )
    .eq("price_batch_id", batchId)
    .single();
  if (batchErr || !batch) {
    return { ok: false, error: batchErr?.message ?? "batch_not_found" };
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from("price_batch_item")
    .select(
      "price_batch_item_id, variant_id, current_cost, new_cost, current_price, charm_price, final_price, manual_override, margin_percent, status, status_reasons",
    )
    .eq("price_batch_id", batchId)
    .order("price_batch_item_id", { ascending: true });
  if (itemErr) return { ok: false, error: itemErr.message };

  const items = (itemRows ?? []) as Array<{
    price_batch_item_id: number;
    variant_id: number;
    current_cost: number | string | null;
    new_cost: number | string | null;
    current_price: number | string | null;
    charm_price: number | string | null;
    final_price: number | string | null;
    manual_override: boolean;
    margin_percent: number | string | null;
    status: "neutral" | "warning" | "critical";
    status_reasons: string[] | null;
  }>;

  // Look up variant + product + brand metadata in batched queries.
  const variantIds = Array.from(new Set(items.map((i) => i.variant_id)));
  const { data: variantRows, error: vErr } =
    variantIds.length > 0
      ? await supabase
          .from("product_variant")
          .select("variant_id, variant_name, sku, product_id")
          .in("variant_id", variantIds)
      : { data: [], error: null };
  if (vErr) return { ok: false, error: vErr.message };

  const productIds = Array.from(
    new Set(
      (variantRows ?? [])
        .map((v) => (v as { product_id: number | null }).product_id)
        .filter((p): p is number => p !== null),
    ),
  );
  const { data: productRows } =
    productIds.length > 0
      ? await supabase
          .from("product")
          .select("product_id, brand_id, product_name")
          .in("product_id", productIds)
      : { data: [] };

  const brandIds = Array.from(
    new Set(
      (productRows ?? [])
        .map((p) => (p as { brand_id: number | null }).brand_id)
        .filter((b): b is number => b !== null),
    ),
  );
  const { data: brandRows } =
    brandIds.length > 0
      ? await supabase
          .from("brand")
          .select("brand_id, brand_name")
          .in("brand_id", brandIds)
      : { data: [] };

  const variantMap = new Map<
    number,
    { product_id: number | null; variant_name: string | null; sku: string | null }
  >();
  for (const v of variantRows ?? []) {
    variantMap.set((v as { variant_id: number }).variant_id, {
      product_id: (v as { product_id: number | null }).product_id,
      variant_name: (v as { variant_name: string | null }).variant_name,
      sku: (v as { sku: string | null }).sku,
    });
  }
  const productMap = new Map<
    number,
    { brand_id: number | null; product_name: string | null }
  >();
  for (const p of productRows ?? []) {
    productMap.set((p as { product_id: number }).product_id, {
      brand_id: (p as { brand_id: number | null }).brand_id,
      product_name: (p as { product_name: string | null }).product_name,
    });
  }
  const brandMap = new Map<number, string>();
  for (const b of brandRows ?? []) {
    brandMap.set(
      (b as { brand_id: number }).brand_id,
      (b as { brand_name: string }).brand_name,
    );
  }

  // We don't currently store the originating price_list / provider per
  // item — looking it up would require a join through price_list. For
  // v1 we leave provider_name null on items; W2 will surface it as a
  // header attribution.
  const itemsOut: BatchDetailItem[] = items.map((it) => {
    const variant = variantMap.get(it.variant_id);
    const product =
      variant?.product_id !== null && variant?.product_id !== undefined
        ? productMap.get(variant.product_id)
        : null;
    const brand =
      product?.brand_id !== null && product?.brand_id !== undefined
        ? brandMap.get(product.brand_id) ?? null
        : null;
    const productName = product?.product_name ?? "";
    const variantName = variant?.variant_name ?? "";
    const composed = [productName, variantName]
      .filter((s) => s && s.trim() !== "")
      .join(" · ");
    const labelBase = composed || `#${it.variant_id}`;
    const label = variant?.sku ? `${labelBase} · ${variant.sku}` : labelBase;
    return {
      price_batch_item_id: it.price_batch_item_id,
      variant_id: it.variant_id,
      variant_label: label,
      brand_name: brand,
      provider_name: null,
      current_cost: it.current_cost === null ? null : Number(it.current_cost),
      new_cost: it.new_cost === null ? null : Number(it.new_cost),
      current_price: it.current_price === null ? null : Number(it.current_price),
      charm_price: it.charm_price === null ? null : Number(it.charm_price),
      final_price: it.final_price === null ? null : Number(it.final_price),
      manual_override: it.manual_override,
      margin_percent: it.margin_percent === null ? null : Number(it.margin_percent),
      status: it.status,
      status_reasons: it.status_reasons ?? [],
    };
  });

  const counts = {
    neutral: itemsOut.filter((i) => i.status === "neutral").length,
    warning: itemsOut.filter((i) => i.status === "warning").length,
    critical: itemsOut.filter((i) => i.status === "critical").length,
  };

  return {
    ok: true,
    batch: {
      price_batch_id: batch.price_batch_id as number,
      batch_name: batch.batch_name as string,
      status: batch.status as PriceBatchStatus,
      created_at: batch.created_at as string,
      updated_at: batch.updated_at as string,
      synced_at: (batch.synced_at as string | null) ?? null,
      item_count: itemsOut.length,
      neutral_count: counts.neutral,
      warning_count: counts.warning,
      critical_count: counts.critical,
      items: itemsOut,
    },
  };
}
