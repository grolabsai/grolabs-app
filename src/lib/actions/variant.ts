"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

/**
 * Server actions for `product_variant` and its companions
 * (`product_variant_attribute` for axis values, `product_pricing` for
 * retail/cost prices).
 *
 * Editable-field allowlist: every column on `product_variant` that the
 * inline-edit UI is allowed to write. Validated in updateVariantField.
 *
 * Excluded: variant_id, instance_id, product_id (system / FK);
 * image_url (deferred to image-upload PR); wazudb1_id (legacy);
 * created_at / updated_at (system).
 */
const VARIANT_EDITABLE_FIELDS = [
  "variant_name",
  "variant_label",
  "sku",
  "barcode",
  "upc",
  "weight_grams",
  "pack_unit",
  "is_active",
  "is_pack",
  "inv_rotation_type",
] as const;

type VariantEditableField = (typeof VARIANT_EDITABLE_FIELDS)[number];

function isVariantEditableField(s: string): s is VariantEditableField {
  return (VARIANT_EDITABLE_FIELDS as readonly string[]).includes(s);
}

export type VariantAxisInput = {
  attribute_id: number;
  value_id?: number | null;
  value_text?: string | null;
  value_number?: number | null;
  unit_id?: number | null;
};

export async function createVariant(input: {
  productId: number;
  axes?: VariantAxisInput[];
  variant_name?: string | null;
  variant_label?: string | null;
  sku?: string | null;
  barcode?: string | null;
  weight_grams?: number | null;
  is_active?: boolean;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();

  // Insert the variant row first; axis values go into
  // product_variant_attribute afterwards. Every field is optional —
  // an empty variant row is allowed (save-anything UI promise). Pricing
  // is its own concern — call upsertVariantPricing separately if a price
  // was entered in the same draft row.
  const { data: variant, error: insertError } = await supabase
    .from("product_variant")
    .insert({
      instance_id: instanceId,
      product_id: input.productId,
      variant_name: input.variant_name?.trim() || null,
      variant_label: input.variant_label?.trim() || null,
      sku: input.sku?.trim() || null,
      barcode: input.barcode?.trim() || null,
      weight_grams: input.weight_grams ?? null,
      is_active: input.is_active ?? true,
    })
    .select("variant_id")
    .single();

  if (insertError) return { error: insertError.message };

  const variantId = variant.variant_id as number;

  const axes = input.axes ?? [];
  if (axes.length > 0) {
    const rows = axes.map((a) => ({
      instance_id: instanceId,
      variant_id: variantId,
      attribute_id: a.attribute_id,
      value_id: a.value_id ?? null,
      value_text: a.value_text ?? null,
      value_number: a.value_number ?? null,
      unit_id: a.unit_id ?? null,
    }));
    const { error: axesError } = await supabase
      .from("product_variant_attribute")
      .insert(rows);
    if (axesError) {
      // Best-effort cleanup: if the axis insert failed we don't want a
      // half-formed variant lingering. Caller should retry.
      await supabase
        .from("product_variant")
        .delete()
        .eq("variant_id", variantId)
        .eq("instance_id", instanceId);
      return { error: axesError.message };
    }
  }

  revalidatePath(`/catalog/products/${input.productId}`, "page");
  return { ok: true as const, variantId };
}

export async function updateVariantField(input: {
  variantId: number;
  field: string;
  value: unknown;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  if (!isVariantEditableField(input.field)) {
    return { error: `Field "${input.field}" is not editable` };
  }

  let value: unknown = input.value;
  if (typeof value === "string" && value.trim() === "") value = null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variant")
    .update({ [input.field]: value })
    .eq("variant_id", input.variantId)
    .eq("instance_id", instanceId);

  if (error) return { error: error.message };
  revalidatePath("/catalog/products", "layout");
  return { ok: true as const };
}

export async function updateVariantAxisValue(input: {
  variantId: number;
  attributeId: number;
  value_id?: number | null;
  value_text?: string | null;
  value_number?: number | null;
  unit_id?: number | null;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();

  // product_variant_attribute has UNIQUE (instance_id, variant_id,
  // attribute_id) — so changing the value of an existing axis is an
  // upsert by that triple. Quantity attributes pass value_number +
  // unit_id; categorical attributes pass value_text (or value_id when
  // sourced from a product_attribute_option row).
  const { error } = await supabase
    .from("product_variant_attribute")
    .upsert(
      {
        instance_id: instanceId,
        variant_id: input.variantId,
        attribute_id: input.attributeId,
        value_id: input.value_id ?? null,
        value_text: input.value_text ?? null,
        value_number: input.value_number ?? null,
        unit_id: input.unit_id ?? null,
      },
      { onConflict: "instance_id,variant_id,attribute_id" },
    );

  if (error) return { error: error.message };
  revalidatePath("/catalog/products", "layout");
  return { ok: true as const };
}

export async function deleteVariant(input: { variantId: number }) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variant")
    .delete()
    .eq("variant_id", input.variantId)
    .eq("instance_id", instanceId);

  if (error) return { error: error.message };
  revalidatePath("/catalog/products", "layout");
  return { ok: true as const };
}

export async function upsertVariantPricing(input: {
  variantId: number;
  listPrice: number;
  costPrice?: number | null;
  channel?: string;
  currency?: string;
  minQuantity?: number;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  // product_pricing.list_price is NOT NULL — we don't accept null here.
  // Clearing a price requires deleting the row, which is out of scope.
  if (
    typeof input.listPrice !== "number" ||
    !Number.isFinite(input.listPrice) ||
    input.listPrice < 0
  ) {
    return { error: "list_price must be a non-negative number" };
  }

  const supabase = await createClient();

  // UNIQUE on (instance_id, variant_id, channel, min_quantity). Default
  // channel = retail, currency = GTQ, min_quantity = 1 — matches the
  // schema defaults.
  const channel = input.channel ?? "retail";
  const currency = input.currency ?? "GTQ";
  const minQuantity = input.minQuantity ?? 1;

  const { error } = await supabase
    .from("product_pricing")
    .upsert(
      {
        instance_id: instanceId,
        variant_id: input.variantId,
        channel,
        currency,
        min_quantity: minQuantity,
        list_price: input.listPrice,
        cost_price: input.costPrice ?? null,
      },
      { onConflict: "instance_id,variant_id,channel,min_quantity" },
    );

  if (error) return { error: error.message };
  revalidatePath("/catalog/products", "layout");
  return { ok: true as const };
}
