"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";
import { triggerProductIndex, triggerProductRemove } from "@/lib/search/trigger";

/**
 * Server actions for the `product` table.
 *
 * Editable-field allowlist: every column on `product` that the inline-edit
 * UI is allowed to write. The action validates the `field` argument
 * against this list before issuing an UPDATE — we never UPDATE arbitrary
 * columns from user input.
 *
 * Excluded: product_id, instance_id (system); image_url (deferred to
 * the image-upload PR); wazudb1_id (legacy migration ref);
 * created_at / updated_at (system).
 */
const PRODUCT_EDITABLE_FIELDS = [
  "product_name",
  "slug",
  "product_type_id",
  "brand_id",
  "short_description",
  "long_description",
  "is_consignment",
  "track_inventory",
  "is_active",
] as const;

type ProductEditableField = (typeof PRODUCT_EDITABLE_FIELDS)[number];

function isProductEditableField(s: string): s is ProductEditableField {
  return (PRODUCT_EDITABLE_FIELDS as readonly string[]).includes(s);
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createProduct(input: { name: string }) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  const supabase = await createClient();

  // product.product_type_id is NOT NULL in the schema, so we pick the
  // first active product_type for the instance and let the user change
  // it from the detail page after. Save-anything UI promise: only name
  // is required from the user.
  const { data: pt, error: ptError } = await supabase
    .from("product_type")
    .select("product_type_id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (ptError) return { error: ptError.message };
  if (!pt) {
    return {
      error:
        "No active product_type — seed at least one product_type for this instance before creating products.",
    };
  }

  const slug = slugify(name) || `producto-${Date.now()}`;

  const { data, error } = await supabase
    .from("product")
    .insert({
      instance_id: instanceId,
      product_name: name,
      slug,
      product_type_id: pt.product_type_id,
    })
    .select("product_id")
    .single();

  if (error) return { error: error.message };
  await triggerProductIndex(instanceId, data.product_id as number);
  revalidatePath("/catalog/products", "page");
  return { ok: true as const, productId: data.product_id as number };
}

export async function updateProductField(input: {
  productId: number;
  field: string;
  value: unknown;
}) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  if (!isProductEditableField(input.field)) {
    return { error: `Field "${input.field}" is not editable` };
  }
  if (input.field === "product_name") {
    if (typeof input.value !== "string" || !input.value.trim()) {
      return { error: "Name is required" };
    }
  }

  // Coerce empty-string text inputs to null for nullable columns.
  // product_name and slug stay as-is (both NOT NULL); booleans, numbers,
  // and explicit nulls pass through untouched.
  let value: unknown = input.value;
  if (
    typeof value === "string" &&
    value.trim() === "" &&
    input.field !== "product_name" &&
    input.field !== "slug"
  ) {
    value = null;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product")
    .update({ [input.field]: value })
    .eq("product_id", input.productId)
    .eq("instance_id", instanceId);

  if (error) return { error: error.message };
  await triggerProductIndex(instanceId, input.productId);
  revalidatePath(`/catalog/products/${input.productId}`, "page");
  revalidatePath("/catalog/products", "page");
  return { ok: true as const };
}

export type CreateProductFullAttributeValue = {
  attributeId: number;
  // Exactly one of these is non-null per row, matching how
  // product_attribute_value already stores list/text-typed values.
  // Quantity descriptive attributes aren't supported here yet — that
  // belongs to the variant editor where unit_of_measure is in scope.
  valueId?: number | null;
  valueText?: string | null;
};

export type CreateProductFullPhoto = {
  url: string;
  isPrimary: boolean;
};

export type CreateProductFullVariantAxis = {
  attributeId: number;
  valueId?: number | null;
  valueText?: string | null;
  valueNumber?: number | null;
  unitId?: number | null;
};

export type CreateProductFullVariant = {
  name: string | null;
  sku: string | null;
  barcode: string | null;
  weightGrams: number | null;
  listPrice: number | null;
  costPrice: number | null;
  isActive: boolean;
  axes: CreateProductFullVariantAxis[];
};

export type CreateProductFullInput = {
  name: string;
  slug: string;
  shortDescription: string | null;
  longDescription: string | null;
  productTypeId: number;
  brandId: number | null;
  categoryIds: number[];
  isActive: boolean;
  trackInventory: boolean;
  isConsignment: boolean;
  variants: CreateProductFullVariant[];
  attributeValues: CreateProductFullAttributeValue[];
  photos: CreateProductFullPhoto[];
};

export async function createProductFull(input: CreateProductFullInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const slug = (input.slug || "").trim() || slugify(name) || `producto-${Date.now()}`;
  if (!Number.isFinite(input.productTypeId)) return { error: "Product type is required" };

  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from("product")
    .insert({
      instance_id: instanceId,
      product_name: name,
      slug,
      short_description: input.shortDescription?.trim() || null,
      long_description: input.longDescription?.trim() || null,
      product_type_id: input.productTypeId,
      brand_id: input.brandId ?? null,
      is_active: input.isActive,
      track_inventory: input.trackInventory,
      is_consignment: input.isConsignment,
    })
    .select("product_id")
    .single();

  if (productError) return { error: productError.message };
  const productId = product.product_id as number;

  // Best-effort cleanup helper: if any child insert fails we delete the
  // product row and propagate the error. The Supabase JS client doesn't
  // expose transactions; an RPC would be the next step if we ever need
  // strict atomicity. For now: cascading FKs do most of the cleanup.
  const rollback = async (msg: string) => {
    await supabase
      .from("product")
      .delete()
      .eq("product_id", productId)
      .eq("instance_id", instanceId);
    return { error: msg };
  };

  if (input.categoryIds.length > 0) {
    const linkRows = input.categoryIds.map((categoryId, idx) => ({
      instance_id: instanceId,
      product_id: productId,
      category_id: categoryId,
      is_primary: idx === 0,
    }));
    const { error: linkError } = await supabase
      .from("product_category_link")
      .insert(linkRows);
    if (linkError) return rollback(linkError.message);
  }

  for (const v of input.variants) {
    const { data: variant, error: variantError } = await supabase
      .from("product_variant")
      .insert({
        instance_id: instanceId,
        product_id: productId,
        variant_name: v.name?.trim() || null,
        sku: v.sku?.trim() || null,
        barcode: v.barcode?.trim() || null,
        weight_grams: v.weightGrams ?? null,
        is_active: v.isActive,
      })
      .select("variant_id")
      .single();
    if (variantError) return rollback(variantError.message);
    const variantId = variant.variant_id as number;

    if (v.axes.length > 0) {
      const axisRows = v.axes.map((a) => ({
        instance_id: instanceId,
        variant_id: variantId,
        attribute_id: a.attributeId,
        value_id: a.valueId ?? null,
        value_text: a.valueText ?? null,
        value_number: a.valueNumber ?? null,
        unit_id: a.unitId ?? null,
      }));
      const { error: axisError } = await supabase
        .from("product_variant_attribute")
        .insert(axisRows);
      if (axisError) return rollback(axisError.message);
    }

    if (v.listPrice !== null && Number.isFinite(v.listPrice) && v.listPrice >= 0) {
      const { error: priceError } = await supabase
        .from("product_pricing")
        .insert({
          instance_id: instanceId,
          variant_id: variantId,
          channel: "retail",
          currency: "GTQ",
          min_quantity: 1,
          list_price: v.listPrice,
          cost_price: v.costPrice ?? null,
        });
      if (priceError) return rollback(priceError.message);
    }
  }

  // Descriptive attributes: one row per attribute via product_attribute_value
  // (UNIQUE on instance_id, product_id, attribute_id). Anything missing
  // both valueId and valueText is dropped — empty entries shouldn't
  // trip the schema's NOT NULL on either of the value columns.
  const attrRows = input.attributeValues
    .filter((a) => a.valueId !== null && a.valueId !== undefined ? true : !!a.valueText?.trim())
    .map((a) => ({
      instance_id: instanceId,
      product_id: productId,
      attribute_id: a.attributeId,
      value_id: a.valueId ?? null,
      value_text: a.valueText?.trim() || null,
    }));
  if (attrRows.length > 0) {
    const { error: attrError } = await supabase
      .from("product_attribute_value")
      .insert(attrRows);
    if (attrError) return rollback(attrError.message);
  }

  // Photos go into product_media (FK product_id; variant_id null for a
  // product-level image). sort_order preserves the user's drag order;
  // is_primary is enforced single-true at the form level.
  const photoRows = input.photos
    .filter((p) => p.url.trim().length > 0)
    .map((p, idx) => ({
      instance_id: instanceId,
      product_id: productId,
      image_url: p.url.trim(),
      is_primary: p.isPrimary,
      sort_order: idx,
    }));
  if (photoRows.length > 0) {
    const { error: photoError } = await supabase
      .from("product_media")
      .insert(photoRows);
    if (photoError) return rollback(photoError.message);
  }

  await triggerProductIndex(instanceId, productId);
  revalidatePath("/catalog/products", "page");
  return { ok: true as const, productId };
}

export async function deleteProduct(input: { productId: number }) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("product")
    .delete()
    .eq("product_id", input.productId)
    .eq("instance_id", instanceId);

  if (error) return { error: error.message };
  await triggerProductRemove(instanceId, input.productId);
  revalidatePath("/catalog/products", "page");
  return { ok: true as const };
}
