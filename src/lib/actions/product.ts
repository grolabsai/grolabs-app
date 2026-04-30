"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

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
  revalidatePath(`/catalog/products/${input.productId}`, "page");
  revalidatePath("/catalog/products", "page");
  return { ok: true as const };
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
  revalidatePath("/catalog/products", "page");
  return { ok: true as const };
}
