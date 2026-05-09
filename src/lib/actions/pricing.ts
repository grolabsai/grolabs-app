"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { parseMoney } from "@/lib/pricing/parse-money";
import type { KeyColumnKind } from "@/lib/pricing/column-detect";
import type { CalculationMode } from "@/lib/pricing/calculate";
import type { CharmStrategy } from "@/lib/pricing/charm";

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
