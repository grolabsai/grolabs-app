"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";
import { revalidatePath } from "next/cache";

export type BrandInput = {
  brand_name: string;
  manufacturer?: string | null;
};

function revalidate() {
  revalidatePath("/catalog/brands", "page");
}

export async function createBrand(input: BrandInput) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const name = input.brand_name.trim();
  if (!name) return { error: "EMPTY_NAME" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand")
    .insert({
      instance_id: instanceId,
      brand_name: name,
      manufacturer: input.manufacturer?.trim() || null,
    })
    .select("brand_id")
    .single();
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const, data: data as { brand_id: number } };
}

export async function updateBrand(brandId: number, input: Partial<BrandInput>) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const patch: Record<string, unknown> = {};
  if (input.brand_name !== undefined) {
    const name = input.brand_name.trim();
    if (!name) return { error: "EMPTY_NAME" };
    patch.brand_name = name;
  }
  if (input.manufacturer !== undefined) {
    patch.manufacturer = input.manufacturer?.trim() || null;
  }
  patch.updated_at = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("brand")
    .update(patch)
    .eq("brand_id", brandId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}

export async function deleteBrand(brandId: number) {
  const instanceId = await currentInstanceId();
  if (instanceId === null) return { error: "No instance" };
  const supabase = await createClient();
  const { count } = await supabase
    .from("product")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("instance_id", instanceId);
  if ((count ?? 0) > 0) return { error: `LINKED:${count}` };
  const { error } = await supabase
    .from("brand")
    .delete()
    .eq("brand_id", brandId)
    .eq("instance_id", instanceId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true as const };
}
