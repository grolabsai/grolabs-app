"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

function revalidateList() {
  revalidatePath("/catalog/products", "page");
}
function revalidateProduct(productId: number) {
  revalidatePath(`/catalog/products/${productId}`, "page");
}

// ─── Product ──────────────────────────────────────────────────────────────────

export type CreateProductInput = {
  product_name: string;
  slug: string;
  product_type_id: number;
  brand_id: number | null;
  primary_category_id: number | null;
  short_description?: string | null;
  image_url?: string | null;
  is_active?: boolean;
  is_consignment?: boolean;
  track_inventory?: boolean;
};

export async function createProduct(input: CreateProductInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("product")
    .insert({
      instance_id: instanceId,
      product_name: input.product_name,
      slug: input.slug,
      product_type_id: input.product_type_id,
      brand_id: input.brand_id ?? null,
      short_description: input.short_description || null,
      image_url: input.image_url || null,
      is_active: input.is_active ?? true,
      is_consignment: input.is_consignment ?? false,
      track_inventory: input.track_inventory ?? true,
    })
    .select("product_id")
    .single();

  if (error) return { error: error.message };
  const productId = (data as { product_id: number }).product_id;

  if (input.primary_category_id != null) {
    const { error: catErr } = await supabase.from("product_category_link").insert({
      instance_id: instanceId,
      product_id: productId,
      category_id: input.primary_category_id,
      is_primary: true,
    });
    if (catErr) {
      await supabase.from("product").delete().eq("product_id", productId).eq("instance_id", instanceId);
      return { error: catErr.message };
    }
  }

  revalidateList();
  return { ok: true as const, data: { product_id: productId } };
}

export type UpdateProductInput = {
  product_name?: string;
  product_type_id?: number;
  brand_id?: number | null;
  primary_category_id?: number | null;
  short_description?: string | null;
  image_url?: string | null;
  is_active?: boolean;
  is_consignment?: boolean;
  track_inventory?: boolean;
};

export async function updateProduct(productId: number, input: UpdateProductInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();

  const { primary_category_id, ...productFields } = input;

  if (Object.keys(productFields).length > 0) {
    const { error } = await supabase
      .from("product")
      .update(productFields)
      .eq("product_id", productId)
      .eq("instance_id", instanceId);
    if (error) return { error: error.message };
  }

  if (primary_category_id != null) {
    // Demote any existing primary link, then upsert new one
    await supabase
      .from("product_category_link")
      .update({ is_primary: false })
      .eq("product_id", productId)
      .eq("instance_id", instanceId)
      .eq("is_primary", true);

    await supabase.from("product_category_link").upsert(
      { instance_id: instanceId, product_id: productId, category_id: primary_category_id, is_primary: true },
      { onConflict: "instance_id,product_id,category_id" },
    );
  }

  revalidateList();
  revalidateProduct(productId);
  return { ok: true as const };
}

export async function deactivateProduct(productId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product")
    .update({ is_active: false })
    .eq("product_id", productId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidateList();
  revalidateProduct(productId);
  return { ok: true as const };
}

// ─── Variant ──────────────────────────────────────────────────────────────────

export type AxisValueInput = {
  attribute_id: number;
  value_id: number | null;
  value_text: string | null;
  value_number: number | null;
  unit_id: number | null;
};

export type CreateVariantInput = {
  product_id: number;
  variant_name: string;
  variant_label: string;
  sku: string;
  image_url?: string | null;
  list_price: number;
  axis_values: AxisValueInput[];
};

export async function createVariant(input: CreateVariantInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();

  // Serialize axis values with explicit nulls so the RPC receives clean JSON
  const axisJson = input.axis_values.map((av) => ({
    attribute_id: av.attribute_id,
    value_id: av.value_id ?? null,
    value_text: av.value_text ?? null,
    value_number: av.value_number ?? null,
    unit_id: av.unit_id ?? null,
  }));

  const { data, error } = await supabase.rpc("create_variant_with_pricing", {
    p_instance_id: instanceId,
    p_product_id: input.product_id,
    p_variant_name: input.variant_name,
    p_variant_label: input.variant_label,
    p_sku: input.sku,
    p_image_url: input.image_url ?? "",
    p_list_price: input.list_price,
    p_axis_values: axisJson,
  });

  if (error) return { error: error.message };
  revalidateProduct(input.product_id);
  return { ok: true as const, data: { variant_id: data as number } };
}

export type UpdateVariantInput = {
  variant_name?: string;
  variant_label?: string;
  sku?: string;
  barcode?: string | null;
  image_url?: string | null;
  is_active?: boolean;
};

export async function updateVariant(variantId: number, productId: number, input: UpdateVariantInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variant")
    .update(input)
    .eq("variant_id", variantId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidateProduct(productId);
  return { ok: true as const };
}

export async function deactivateVariant(variantId: number, productId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variant")
    .update({ is_active: false })
    .eq("variant_id", variantId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidateProduct(productId);
  return { ok: true as const };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export async function checkSlugUnique(slug: string, excludeProductId?: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" as string };
  const supabase = await createClient();
  let q = supabase
    .from("product")
    .select("product_id")
    .eq("slug", slug)
    .eq("instance_id", instanceId);
  if (excludeProductId != null) q = q.neq("product_id", excludeProductId);
  const { data } = await q.maybeSingle();
  return { unique: !data };
}

export async function checkSkuUnique(sku: string, excludeVariantId?: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" as string };
  const supabase = await createClient();
  let q = supabase
    .from("product_variant")
    .select("variant_id")
    .eq("sku", sku)
    .eq("instance_id", instanceId);
  if (excludeVariantId != null) q = q.neq("variant_id", excludeVariantId);
  const { data } = await q.maybeSingle();
  return { unique: !data };
}
