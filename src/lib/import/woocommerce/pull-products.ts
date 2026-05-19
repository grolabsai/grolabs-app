/**
 * Products pass of the WooCommerce import.
 * Spec: docs/policy/wc-import.md §5 step 3.
 *
 * What this pass does, per product:
 *   1. Map the WC payload (mapProduct).
 *   2. If variable, fetch the full /products/{id}/variations payload and
 *      embed the objects back onto wc_raw.variations (lossless replacement
 *      of the v1 id-only array).
 *   3. Upsert product on (instance_id, woocommerce_id).
 *   4. Refresh product_category_link (delete-then-insert per product).
 *   5. Refresh product_media (URL-keyed reconcile).
 *   6. Upsert product_variant rows on (instance_id, woocommerce_id) with
 *      weight_grams converted from the WC store weight_unit.
 *   7. Upsert product_pricing per variant (channel=retail, min_quantity=1)
 *      from variation.regular_price / sale_price; currency from store settings.
 *   8. For variable products: upsert the variation axes as product_attribute
 *      rows (one per axis_code, instance-scoped, dedup across products),
 *      upsert each option value as product_attribute_option, write
 *      product_variant_attribute rows linking each variant → axis → option,
 *      and flip is_variant_axis on the primary (first) category mapping.
 *   9. Upsert tags as commercial_tag rows (dedup across the run) and
 *      refresh product_tag_link.
 *
 * The full event-by-event log accumulates into a DebugReport that is
 * persisted on instance.integrations_config.woocommerce.last_import_debug
 * and surfaced on the import page's right-side debug pane.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listProductsPage,
  listProductVariationsPage,
  getStoreSettings,
  type WooClient,
  type WooProductRaw,
  type WooVariationRaw,
  type WooStoreSettings,
} from "@/lib/sync/woocommerce-client";
import {
  mapProduct,
  mapVariation,
  mapTag,
  deriveAxisDefs,
  toOptionCode,
  type AxisDef,
  type ProductWrite,
  type VariantWrite,
} from "./map";
import type {
  DebugReport,
  ImportError,
  ImportProgress,
  ImportSummary,
} from "./types";

type ProgressFn = (p: ImportProgress) => Promise<void> | void;

const MAX_PER_PRODUCT_ENTRIES = 200;

export async function pullProducts(
  supabase: SupabaseClient,
  wc: WooClient,
  instanceId: number,
  onProgress?: ProgressFn,
): Promise<ImportSummary> {
  const startedAtISO = new Date().toISOString();
  const start = Date.now();

  const errors: ImportError[] = [];
  const renamedSlugs: ImportSummary["renamedSlugs"] = [];

  // Best-effort store settings. Soft-fails: leave units null and currency
  // unset, then variants store no weight and pricing falls back to the
  // schema default (GTQ).
  let storeSettings: WooStoreSettings = { weightUnit: null, currency: null };
  const settingsResult = await getStoreSettings(wc);
  if (settingsResult.ok) {
    storeSettings = settingsResult.data;
  } else {
    errors.push({
      message: `WC store settings unavailable (${settingsResult.status}): ${settingsResult.error} — weight_grams will be NULL, pricing will use default currency`,
    });
  }

  // Pre-fetch the category WC-id → GroLabs-id map once.
  const categoryIdMap = await loadCategoryIdMap(supabase, instanceId);

  // Instance currency — used by the simple-product fallback path
  // (ensureDefaultVariant). Variable-product variant pricing uses the WC
  // store currency from storeSettings.currency. Falls back to GTQ if neither
  // is configured.
  const currency = await loadInstanceCurrency(supabase, instanceId);

  // Debug accumulator — counts are exact, perProduct is capped.
  const totals: DebugReport["totals"] = {
    productsProcessed: 0,
    productsUpserted: 0,
    productsFailed: 0,
    productsRenamed: 0,
    variantsUpserted: 0,
    pricingRowsUpserted: 0,
    tagsUpserted: 0,
    tagLinksWritten: 0,
    attributesUpserted: 0,
    attributeOptionsUpserted: 0,
    variantAttributeRowsUpserted: 0,
    categoryAxisFlips: 0,
  };
  const perProduct: DebugReport["perProduct"] = [];

  let page = 1;
  let total = 0;
  let upserted = 0;

  while (true) {
    const r = await listProductsPage(wc, page, 100, "publish");
    if (!r.ok) {
      errors.push({ message: `WC products page ${page}: ${r.error}` });
      break;
    }
    if (r.data.length === 0) break;

    for (const raw of r.data) {
      total += 1;
      totals.productsProcessed += 1;
      const mapped = mapProduct(raw);

      const isVariable =
        raw.type === "variable" ||
        (Array.isArray(raw.variations) && raw.variations.length > 0);

      const productEntry: DebugReport["perProduct"][number] = {
        woocommerceId: raw.id,
        name: mapped.product_name,
        productId: null,
        variable: isVariable,
        variants: [],
        variantAxes: [],
        tagsLinked: [],
        axisFlipsOnCategoryId: null,
        pricingRowsWritten: 0,
        notes: [],
      };

      // ── Variations fetch + wc_raw embedding ──────────────────────────
      let variations: WooVariationRaw[] = [];
      if (isVariable) {
        const fetched = await fetchAllVariations(wc, raw.id);
        if (fetched.ok) {
          variations = fetched.variations;
          mapped.wc_raw.variations = variations;
          productEntry.notes.push(
            `fetched ${variations.length} WC variation object(s); embedded onto wc_raw.variations`,
          );
        } else {
          errors.push({
            woocommerceId: raw.id,
            identifier: mapped.product_name,
            message: `fetch variations: ${fetched.error}`,
          });
          productEntry.notes.push(
            `variations fetch FAILED: ${fetched.error}`,
          );
        }
      }

      const renamesBefore = renamedSlugs.length;
      try {
        // ── Parent upsert ──────────────────────────────────────────────
        const productId = await upsertProduct(
          supabase,
          instanceId,
          mapped,
          renamedSlugs,
        );
        productEntry.productId = productId;
        if (renamedSlugs.length > renamesBefore) {
          totals.productsRenamed += 1;
          const r2 = renamedSlugs[renamedSlugs.length - 1];
          productEntry.notes.push(`slug collision: renamed ${r2.from} → ${r2.to}`);
        }

        // ── Variants ───────────────────────────────────────────────────
        // Returns a wcId → variant_id map so we can write pricing + PVA
        // rows without an extra round-trip.
        const variantIdByWcId = await upsertVariantsAndReturn(
          supabase,
          instanceId,
          productId,
          variations,
          storeSettings.weightUnit,
          raw.id,
          errors,
          productEntry,
        );
        totals.variantsUpserted += variantIdByWcId.size;

        // ── Pricing per variant ────────────────────────────────────────
        if (variantIdByWcId.size > 0) {
          const pricingCount = await upsertVariantPricing(
            supabase,
            instanceId,
            variations,
            variantIdByWcId,
            storeSettings.currency ?? "GTQ",
            raw.id,
            errors,
          );
          totals.pricingRowsUpserted += pricingCount;
          productEntry.pricingRowsWritten = pricingCount;
        }

        // ── Category links (must run before axis flip so the primary
        // category is in place) ───────────────────────────────────────
        const primaryCategoryId = await refreshCategoryLinks(
          supabase,
          instanceId,
          productId,
          mapped.category_woocommerce_ids,
          categoryIdMap,
          mapped.woocommerce_id,
          errors,
        );

        // ── Product media (existing behaviour) ─────────────────────────
        await refreshProductMedia(
          supabase,
          instanceId,
          productId,
          mapped.images,
          mapped.woocommerce_id,
          errors,
        );
        // ── Variant axes / options / variant_attribute / category flip ──
        if (isVariable && variantIdByWcId.size > 0) {
          const axisOutcome = await syncAxesForProduct({
            supabase,
            instanceId,
            productId,
            rawProduct: raw,
            variations,
            variantIdByWcId,
            primaryCategoryId,
            productWcId: raw.id,
            errors,
            productEntry,
          });
          totals.attributesUpserted += axisOutcome.attributesUpserted;
          totals.attributeOptionsUpserted += axisOutcome.optionsUpserted;
          totals.variantAttributeRowsUpserted += axisOutcome.pvaRowsUpserted;
          totals.categoryAxisFlips += axisOutcome.axisFlips;
        }

        // ── Tags ───────────────────────────────────────────────────────
        const tagOutcome = await syncProductTags(
          supabase,
          instanceId,
          productId,
          raw.tags ?? [],
          raw.id,
          errors,
          productEntry,
        );
        totals.tagsUpserted += tagOutcome.tagsUpserted;
        totals.tagLinksWritten += tagOutcome.linksWritten;

        // ── Default variant fallback ───────────────────────────────────
        // Products with no WC variations (simple/grouped/external, or
        // variable products whose variations fetch failed) still need a
        // placeholder product_variant + product_pricing so the rest of
        // the GroLabs catalog (search index, sync) has something to bind
        // to. ensureDefaultVariant() is a no-op when variants already
        // exist, so it's safe to call unconditionally — for variable
        // products that succeeded above, this just returns.
        await ensureDefaultVariant(
          supabase,
          instanceId,
          productId,
          mapped,
          currency,
          errors,
        );

        totals.productsUpserted += 1;
        upserted += 1;
      } catch (err) {
        totals.productsFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          woocommerceId: mapped.woocommerce_id,
          identifier: mapped.product_name,
          message,
        });
        productEntry.notes.push(`FAILED: ${message}`);
      }

      if (perProduct.length < MAX_PER_PRODUCT_ENTRIES) {
        perProduct.push(productEntry);
      }
    }

    if (onProgress) {
      await onProgress({
        phase: "products",
        page,
        processed: total,
        upserted,
        failed: errors.filter((e) => e.woocommerceId !== undefined).length,
        startedAt: startedAtISO,
      });
    }

    if (r.data.length < 100) break;
    page += 1;
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - start;

  const debug: DebugReport = {
    phase: "products",
    startedAt: startedAtISO,
    completedAt,
    durationMs,
    wcSettings: {
      weightUnit: storeSettings.weightUnit,
      currency: storeSettings.currency,
    },
    totals,
    perProduct,
  };

  return {
    total,
    upserted,
    failed: errors.filter((e) => e.woocommerceId !== undefined).length,
    durationMs,
    errors,
    renamedSlugs,
    debug,
  };
}

// ─── Variation fetching ──────────────────────────────────────────────────

async function fetchAllVariations(
  wc: WooClient,
  productWcId: number,
): Promise<
  | { ok: true; variations: WooVariationRaw[] }
  | { ok: false; error: string }
> {
  const all: WooVariationRaw[] = [];
  let page = 1;
  for (;;) {
    const r = await listProductVariationsPage(wc, productWcId, page, 100);
    if (!r.ok) return { ok: false, error: r.error };
    all.push(...r.data);
    if (r.data.length < 100) break;
    page += 1;
  }
  return { ok: true, variations: all };
}

// ─── Variant upsert (returns wcId → variant_id) ──────────────────────────

async function upsertVariantsAndReturn(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  variations: WooVariationRaw[],
  weightUnit: "g" | "kg" | "oz" | "lb" | null,
  productWcId: number,
  errors: ImportError[],
  productEntry: DebugReport["perProduct"][number],
): Promise<Map<number, number>> {
  if (variations.length === 0) return new Map();

  const rows = variations.map((v) => {
    const m: VariantWrite = mapVariation(v, { weightUnit });
    return {
      instance_id: instanceId,
      product_id: productId,
      woocommerce_id: m.woocommerce_id,
      sku: m.sku,
      variant_name: m.variant_name,
      barcode: m.barcode,
      image_url: m.image_url,
      is_active: m.is_active,
      weight_grams: m.weight_grams,
    };
  });

  const { data, error } = await supabase
    .from("product_variant")
    .upsert(rows, { onConflict: "instance_id,woocommerce_id" })
    .select("variant_id, woocommerce_id, sku, variant_name, weight_grams");

  if (error) {
    errors.push({
      woocommerceId: productWcId,
      message: `upsert ${rows.length} variant(s): ${error.message}`,
    });
    return new Map();
  }

  const result = new Map<number, number>();
  for (const row of data ?? []) {
    const wcId = Number((row as { woocommerce_id: number }).woocommerce_id);
    const variantId = Number((row as { variant_id: number }).variant_id);
    if (!Number.isFinite(wcId) || !Number.isFinite(variantId)) continue;
    result.set(wcId, variantId);
    productEntry.variants.push({
      wcId,
      sku: (row as { sku: string | null }).sku ?? null,
      name: (row as { variant_name: string | null }).variant_name ?? null,
      weightGrams: (row as { weight_grams: number | null }).weight_grams ?? null,
    });
  }
  return result;
}

// ─── Pricing ─────────────────────────────────────────────────────────────

async function upsertVariantPricing(
  supabase: SupabaseClient,
  instanceId: number,
  variations: WooVariationRaw[],
  variantIdByWcId: Map<number, number>,
  currency: string,
  productWcId: number,
  errors: ImportError[],
): Promise<number> {
  const rows: Array<Record<string, unknown>> = [];
  for (const v of variations) {
    const variantId = variantIdByWcId.get(v.id);
    if (variantId == null) continue;

    const regular = parseDecimalStr(v.regular_price ?? v.price ?? null);
    // list_price is NOT NULL in the schema — without a regular price we
    // can't insert a pricing row. The variant still exists; storefront
    // can still surface "consultar precio".
    if (regular == null) continue;
    const sale = parseDecimalStr(v.sale_price ?? null);

    rows.push({
      instance_id: instanceId,
      variant_id: variantId,
      channel: "retail",
      currency: currency || "GTQ",
      min_quantity: 1,
      list_price: regular,
      sale_price: sale,
      is_active: true,
    });
  }
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("product_pricing")
    .upsert(rows, {
      onConflict: "instance_id,variant_id,channel,min_quantity",
    });

  if (error) {
    errors.push({
      woocommerceId: productWcId,
      message: `upsert ${rows.length} pricing row(s): ${error.message}`,
    });
    return 0;
  }
  return rows.length;
}

function parseDecimalStr(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Variant axes / options / variant_attribute / category flip ──────────

type AxisOutcome = {
  attributesUpserted: number;
  optionsUpserted: number;
  pvaRowsUpserted: number;
  axisFlips: number;
};

/**
 * Wire up the structured variant axes for a variable product:
 *
 *   - product_attribute (one per axis_code, instance-scoped, dedup across
 *     products) — keyed on (instance_id, attribute_code).
 *   - product_attribute_option (one per distinct option value per axis) —
 *     keyed on (instance_id, attribute_id, value_code).
 *   - product_variant_attribute (one per variant × axis) — keyed on
 *     (instance_id, variant_id, attribute_id), value_id pointing to the
 *     option above.
 *   - category_product_attribute (is_variant_axis flipped to true on the
 *     primary category mapping; variant_axis_order from the WC position).
 *
 * Idempotent: re-imports update in place and never create duplicates.
 */
async function syncAxesForProduct(args: {
  supabase: SupabaseClient;
  instanceId: number;
  productId: number;
  rawProduct: WooProductRaw;
  variations: WooVariationRaw[];
  variantIdByWcId: Map<number, number>;
  primaryCategoryId: number | null;
  productWcId: number;
  errors: ImportError[];
  productEntry: DebugReport["perProduct"][number];
}): Promise<AxisOutcome> {
  const {
    supabase,
    instanceId,
    rawProduct,
    variations,
    variantIdByWcId,
    primaryCategoryId,
    productWcId,
    errors,
    productEntry,
  } = args;

  const axes = deriveAxisDefs(rawProduct);
  if (axes.length === 0) {
    return {
      attributesUpserted: 0,
      optionsUpserted: 0,
      pvaRowsUpserted: 0,
      axisFlips: 0,
    };
  }

  // ── 1. Upsert axis attributes ──────────────────────────────────────────
  const attrRows = axes.map((a) => ({
    instance_id: instanceId,
    attribute_code: a.code,
    attribute_name: a.name,
    // Variation axes are option-backed values rendered as plain strings.
    // Quantity attributes (weight, volume) are not auto-detected here —
    // that's a follow-up enrichment pass.
    data_type: "enum",
    is_filterable: true,
    is_searchable: true,
    is_multivalue: false,
  }));
  const { data: attrData, error: attrErr } = await supabase
    .from("product_attribute")
    .upsert(attrRows, { onConflict: "instance_id,attribute_code" })
    .select("attribute_id, attribute_code, attribute_name");

  if (attrErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `upsert ${attrRows.length} variant axis attribute(s): ${attrErr.message}`,
    });
    return {
      attributesUpserted: 0,
      optionsUpserted: 0,
      pvaRowsUpserted: 0,
      axisFlips: 0,
    };
  }

  const attrIdByCode = new Map<string, number>();
  for (const row of attrData ?? []) {
    const code = String((row as { attribute_code: string }).attribute_code);
    const id = Number((row as { attribute_id: number }).attribute_id);
    if (code && Number.isFinite(id)) attrIdByCode.set(code, id);
  }
  const attributesUpserted = attrIdByCode.size;

  // Track the option values we observed per axis (for the debug log).
  const optionsByAxisCode = new Map<string, Set<string>>();

  // ── 2. Build option set from variations + upsert ───────────────────────
  type PendingPVA = {
    variant_id: number;
    attribute_code: string;
    value_text: string;
  };
  const pendingPVA: PendingPVA[] = [];

  for (const v of variations) {
    const variantId = variantIdByWcId.get(v.id);
    if (variantId == null) continue;
    const vAttrs = Array.isArray(v.attributes) ? v.attributes : [];
    for (const a of vAttrs) {
      const slugOrName = (a.slug ?? a.name ?? "").trim();
      const option = (a.option ?? "").trim();
      if (!slugOrName || !option) continue;
      const code = toAttributeCodeMatching(axes, slugOrName);
      if (!code) continue;
      if (!attrIdByCode.has(code)) continue;
      if (!optionsByAxisCode.has(code)) {
        optionsByAxisCode.set(code, new Set());
      }
      optionsByAxisCode.get(code)!.add(option);
      pendingPVA.push({ variant_id: variantId, attribute_code: code, value_text: option });
    }
  }

  // Upsert all distinct options in one call. value_code is the natural
  // key per (instance, attribute) and is the conflict target.
  const optionRows: Array<Record<string, unknown>> = [];
  for (const [code, valueSet] of optionsByAxisCode) {
    const attrId = attrIdByCode.get(code)!;
    for (const value of valueSet) {
      optionRows.push({
        instance_id: instanceId,
        attribute_id: attrId,
        value_code: toOptionCode(value),
        value,
        is_active: true,
      });
    }
  }

  const optionIdByKey = new Map<string, number>(); // key = `${attrId}::${value_code}`
  if (optionRows.length > 0) {
    const { data: optData, error: optErr } = await supabase
      .from("product_attribute_option")
      .upsert(optionRows, {
        onConflict: "instance_id,attribute_id,value_code",
      })
      .select("value_id, attribute_id, value_code");
    if (optErr) {
      errors.push({
        woocommerceId: productWcId,
        message: `upsert ${optionRows.length} attribute option(s): ${optErr.message}`,
      });
    } else {
      for (const row of optData ?? []) {
        const attrId = Number((row as { attribute_id: number }).attribute_id);
        const code = String((row as { value_code: string }).value_code);
        const id = Number((row as { value_id: number }).value_id);
        if (Number.isFinite(attrId) && code && Number.isFinite(id)) {
          optionIdByKey.set(`${attrId}::${code}`, id);
        }
      }
    }
  }
  const optionsUpserted = optionIdByKey.size;

  // ── 3. product_variant_attribute rows ──────────────────────────────────
  const pvaRows: Array<Record<string, unknown>> = [];
  // Dedup on (variant_id, attribute_id) — WC sometimes emits the same axis
  // twice on a variation; the last-write-wins.
  const seen = new Set<string>();
  for (const p of pendingPVA) {
    const attrId = attrIdByCode.get(p.attribute_code)!;
    const optKey = `${attrId}::${toOptionCode(p.value_text)}`;
    const valueId = optionIdByKey.get(optKey);
    const seenKey = `${p.variant_id}::${attrId}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    pvaRows.push({
      instance_id: instanceId,
      variant_id: p.variant_id,
      attribute_id: attrId,
      value_id: valueId ?? null,
      value_text: valueId ? null : p.value_text,
    });
  }

  let pvaRowsUpserted = 0;
  if (pvaRows.length > 0) {
    const { error: pvaErr, count } = await supabase
      .from("product_variant_attribute")
      .upsert(pvaRows, {
        onConflict: "instance_id,variant_id,attribute_id",
        count: "exact",
      });
    if (pvaErr) {
      errors.push({
        woocommerceId: productWcId,
        message: `upsert ${pvaRows.length} variant attribute row(s): ${pvaErr.message}`,
      });
    } else {
      pvaRowsUpserted = count ?? pvaRows.length;
    }
  }

  // ── 4. Variant-axis flip on the primary category ──────────────────────
  let axisFlips = 0;
  if (primaryCategoryId != null && axes.length > 0) {
    const cpaRows = axes.map((a, idx) => ({
      instance_id: instanceId,
      category_id: primaryCategoryId,
      attribute_id: attrIdByCode.get(a.code)!,
      is_variant_axis: true,
      variant_axis_order: idx,
    }));
    const { error: cpaErr, count: cpaCount } = await supabase
      .from("category_product_attribute")
      .upsert(cpaRows, {
        onConflict: "instance_id,category_id,attribute_id",
        count: "exact",
      });
    if (cpaErr) {
      errors.push({
        woocommerceId: productWcId,
        message: `flip ${cpaRows.length} variant axis on category ${primaryCategoryId}: ${cpaErr.message}`,
      });
    } else {
      axisFlips = cpaCount ?? cpaRows.length;
      productEntry.axisFlipsOnCategoryId = primaryCategoryId;
    }
  }

  // ── Per-product debug entry ────────────────────────────────────────────
  for (const a of axes) {
    productEntry.variantAxes.push({
      code: a.code,
      name: a.name,
      optionsSeen: Array.from(optionsByAxisCode.get(a.code) ?? []),
    });
  }

  return {
    attributesUpserted,
    optionsUpserted,
    pvaRowsUpserted,
    axisFlips,
  };
}

/** Match a variation's attribute slug-or-name against the known axis defs
 *  and return the canonical attribute_code. WC variations carry either the
 *  taxonomy slug (pa_size) or the display name ("Size") — we try both. */
function toAttributeCodeMatching(axes: AxisDef[], slugOrName: string): string | null {
  const lower = slugOrName.toLowerCase();
  // Try direct match by code.
  for (const a of axes) {
    if (a.code === lower) return a.code;
  }
  // Try by stripping pa_ and slugifying.
  const slug = lower.startsWith("pa_") ? lower.slice(3) : lower;
  const cleaned = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  for (const a of axes) {
    if (a.code === cleaned) return a.code;
  }
  // Fall back to name match.
  for (const a of axes) {
    if (a.name.toLowerCase() === slugOrName.toLowerCase()) return a.code;
  }
  return null;
}

// ─── Tags ────────────────────────────────────────────────────────────────

async function syncProductTags(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  rawTags: Array<{ id: number; name?: string; slug?: string }>,
  productWcId: number,
  errors: ImportError[],
  productEntry: DebugReport["perProduct"][number],
): Promise<{ tagsUpserted: number; linksWritten: number }> {
  if (rawTags.length === 0) {
    // Still clear any stale links: if a tag was removed in WC, the GroLabs
    // catalog should reflect that.
    await supabase
      .from("product_tag_link")
      .delete()
      .eq("instance_id", instanceId)
      .eq("product_id", productId);
    return { tagsUpserted: 0, linksWritten: 0 };
  }

  const mapped = rawTags
    .map(mapTag)
    .filter((t): t is NonNullable<ReturnType<typeof mapTag>> => t !== null);
  if (mapped.length === 0) return { tagsUpserted: 0, linksWritten: 0 };

  // Upsert all tags in one call. (instance_id, tag_code) is the natural key.
  const tagRows = mapped.map((t) => ({
    instance_id: instanceId,
    tag_code: t.tag_code,
    tag_name: t.tag_name,
    is_active: true,
  }));
  const { data: tagData, error: tagErr } = await supabase
    .from("commercial_tag")
    .upsert(tagRows, { onConflict: "instance_id,tag_code" })
    .select("tag_id, tag_code, tag_name");
  if (tagErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `upsert ${tagRows.length} tag(s): ${tagErr.message}`,
    });
    return { tagsUpserted: 0, linksWritten: 0 };
  }

  const tagIdByCode = new Map<string, number>();
  for (const row of tagData ?? []) {
    const code = String((row as { tag_code: string }).tag_code);
    const id = Number((row as { tag_id: number }).tag_id);
    if (code && Number.isFinite(id)) tagIdByCode.set(code, id);
    productEntry.tagsLinked.push({
      code: String((row as { tag_code: string }).tag_code),
      name: String((row as { tag_name: string }).tag_name),
    });
  }
  const tagsUpserted = tagIdByCode.size;

  // Refresh product_tag_link (delete-and-insert, same pattern as
  // product_category_link). Volumes are tiny per product.
  await supabase
    .from("product_tag_link")
    .delete()
    .eq("instance_id", instanceId)
    .eq("product_id", productId);

  const linkRows = Array.from(tagIdByCode.values()).map((tagId) => ({
    instance_id: instanceId,
    product_id: productId,
    tag_id: tagId,
  }));
  if (linkRows.length === 0) return { tagsUpserted, linksWritten: 0 };

  const { error: linkErr } = await supabase
    .from("product_tag_link")
    .insert(linkRows);
  if (linkErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `insert ${linkRows.length} tag link(s): ${linkErr.message}`,
    });
    return { tagsUpserted, linksWritten: 0 };
  }
  return { tagsUpserted, linksWritten: linkRows.length };
}

// ─── Reusable scaffolding ────────────────────────────────────────────────

async function loadCategoryIdMap(
  supabase: SupabaseClient,
  instanceId: number,
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("category")
    .select("category_id, woocommerce_id")
    .eq("instance_id", instanceId)
    .not("woocommerce_id", "is", null);

  if (error) return new Map();
  return new Map(
    (data ?? [])
      .filter((r) => r.woocommerce_id != null)
      .map((r) => [Number(r.woocommerce_id), Number(r.category_id)]),
  );
}

async function loadInstanceCurrency(
  supabase: SupabaseClient,
  instanceId: number,
): Promise<string> {
  const { data } = await supabase
    .from("instance")
    .select("default_currency")
    .eq("instance_id", instanceId)
    .maybeSingle<{ default_currency: string | null }>();
  return data?.default_currency ?? "GTQ";
}

/**
 * Ensure every WC-imported product has at least one product_variant row.
 *
 * The GroLabs catalog model is variant-centric — sku/pricing/stock live on
 * product_variant + product_pricing. WC import v1 originally created only
 * the parent product row, leaving the search indexer to special-case
 * "no variants" via parent-field fallback. To keep the model uniform,
 * we now materialise a single 1:1 placeholder variant per imported
 * product, plus a retail product_pricing row mirroring the parent price.
 *
 * Behaviour:
 *  - 0 variants today → insert one placeholder + (optionally) a pricing row.
 *  - >=1 variants today → no-op. The product already has variants (manual
 *    additions in the GroLabs UI, a prior wc-import-variants restructure
 *    of this product's wc_raw.variations[], or an earlier run of this same
 *    helper); we never duplicate.
 *
 * Variable WC products: get the same placeholder. The future
 * wc-import-variants restructure pass is expected to detect a single
 * placeholder variant (woocommerce_id IS NULL) on a variable parent and
 * replace it with real variants exploded from wc_raw.variations[].
 */
async function ensureDefaultVariant(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  mapped: ProductWrite,
  currency: string,
  errors: ImportError[],
): Promise<void> {
  const { count, error: countErr } = await supabase
    .from("product_variant")
    .select("variant_id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (countErr) {
    errors.push({
      woocommerceId: mapped.woocommerce_id,
      message: `count variants: ${countErr.message}`,
    });
    return;
  }
  if ((count ?? 0) > 0) return;

  const { data: inserted, error: insErr } = await supabase
    .from("product_variant")
    .insert({
      instance_id: instanceId,
      product_id: productId,
      sku: mapped.sku,
      barcode: mapped.barcode,
      is_active: true,
    })
    .select("variant_id")
    .single();

  if (insErr || !inserted) {
    errors.push({
      woocommerceId: mapped.woocommerce_id,
      message: `insert default variant: ${insErr?.message ?? "unknown"}`,
    });
    return;
  }

  if (mapped.price === null) return;

  const { error: priceErr } = await supabase.from("product_pricing").insert({
    instance_id: instanceId,
    variant_id: Number(inserted.variant_id),
    channel: "retail",
    currency,
    list_price: mapped.price,
    cost_price: mapped.cost,
  });

  if (priceErr) {
    errors.push({
      woocommerceId: mapped.woocommerce_id,
      message: `insert default pricing: ${priceErr.message}`,
    });
  }
}

async function upsertProduct(
  supabase: SupabaseClient,
  instanceId: number,
  row: ProductWrite,
  renamedSlugs: ImportSummary["renamedSlugs"],
): Promise<number> {
  const baseSlug = row.slug;

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-wc${row.woocommerce_id}`;

    const { data, error } = await supabase
      .from("product")
      .upsert(
        {
          instance_id: instanceId,
          woocommerce_id: row.woocommerce_id,
          product_name: row.product_name,
          slug,
          short_description: row.short_description,
          long_description: row.long_description,
          image_url: row.image_url,
          sku: row.sku,
          price: row.price,
          sale_price: row.sale_price,
          stock_quantity: row.stock_quantity,
          barcode: row.barcode,
          cost: row.cost,
          wc_raw: row.wc_raw,
          is_active: true,
        },
        { onConflict: "instance_id,woocommerce_id" },
      )
      .select("product_id")
      .single();

    if (!error && data) {
      if (attempt === 1) {
        renamedSlugs.push({
          woocommerceId: row.woocommerce_id,
          from: baseSlug,
          to: slug,
        });
      }
      return Number(data.product_id);
    }

    const isSlugDupe =
      !!error && error.code === "23505" && /slug/i.test(error.message ?? "");
    if (!isSlugDupe || attempt === 1) {
      throw new Error(error?.message ?? "Unknown upsert error");
    }
  }
  throw new Error("Product upsert exhausted retry attempts");
}

/** Returns the GroLabs primary category_id (the first matched WC category)
 *  or null if no WC category mapped. Used by syncAxesForProduct to know
 *  where to flip is_variant_axis. */
async function refreshCategoryLinks(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  wcCategoryIds: number[],
  categoryIdMap: Map<number, number>,
  productWcId: number,
  errors: ImportError[],
): Promise<number | null> {
  const { error: delErr } = await supabase
    .from("product_category_link")
    .delete()
    .eq("instance_id", instanceId)
    .eq("product_id", productId);

  if (delErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `clear category links: ${delErr.message}`,
    });
    return null;
  }

  if (wcCategoryIds.length === 0) return null;

  let primary: number | null = null;
  const rows = wcCategoryIds
    .map((wcCatId, idx) => {
      const catId = categoryIdMap.get(wcCatId);
      if (!catId) return null;
      if (idx === 0) primary = catId;
      return {
        instance_id: instanceId,
        product_id: productId,
        category_id: catId,
        is_primary: idx === 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    errors.push({
      woocommerceId: productWcId,
      message: `categories ${wcCategoryIds.join(",")} not found in GroLabs — run category import first`,
    });
    return null;
  }

  const { error: insErr } = await supabase.from("product_category_link").insert(rows);
  if (insErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `insert category links: ${insErr.message}`,
    });
    return null;
  }
  return primary;
}

/** URL-keyed reconcile of product_media. Same shape as before — unchanged. */
async function refreshProductMedia(
  supabase: SupabaseClient,
  instanceId: number,
  productId: number,
  images: Array<{ src: string; alt: string | null }>,
  productWcId: number,
  errors: ImportError[],
): Promise<void> {
  const incomingUrls = images.map((i) => i.src);

  const { data: existing, error: selErr } = await supabase
    .from("product_media")
    .select("media_id, image_url")
    .eq("instance_id", instanceId)
    .eq("product_id", productId);
  if (selErr) {
    errors.push({
      woocommerceId: productWcId,
      message: `read product_media: ${selErr.message}`,
    });
    return;
  }

  const existingByUrl = new Map<string, number>(
    (existing ?? []).map((r) => [
      String((r as { image_url: string }).image_url),
      Number((r as { media_id: number }).media_id),
    ]),
  );

  const incomingSet = new Set(incomingUrls);
  const toDeleteIds = (existing ?? [])
    .filter((r) => !incomingSet.has(String((r as { image_url: string }).image_url)))
    .map((r) => Number((r as { media_id: number }).media_id));

  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("product_media")
      .delete()
      .in("media_id", toDeleteIds);
    if (delErr) {
      errors.push({
        woocommerceId: productWcId,
        message: `delete obsolete product_media: ${delErr.message}`,
      });
      return;
    }
  }

  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    const isPrimary = idx === 0;
    const existingId = existingByUrl.get(img.src);
    if (existingId !== undefined) {
      const { error: updErr } = await supabase
        .from("product_media")
        .update({
          is_primary: isPrimary,
          sort_order: idx,
          alt_text: img.alt,
        })
        .eq("media_id", existingId);
      if (updErr) {
        errors.push({
          woocommerceId: productWcId,
          message: `update product_media ${existingId}: ${updErr.message}`,
        });
      }
    } else {
      const { error: insErr } = await supabase.from("product_media").insert({
        instance_id: instanceId,
        product_id: productId,
        image_url: img.src,
        alt_text: img.alt,
        is_primary: isPrimary,
        sort_order: idx,
      });
      if (insErr) {
        errors.push({
          woocommerceId: productWcId,
          message: `insert product_media ${img.src}: ${insErr.message}`,
        });
      }
    }
  }
}
