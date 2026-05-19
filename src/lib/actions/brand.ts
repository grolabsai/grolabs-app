"use server";

import { createClient } from "@/lib/supabase/server";
import { currentInstanceId } from "@/lib/instance";

/**
 * Find an existing brand by case-insensitive name in the current instance,
 * or create a new one. Returns the resulting brand row.
 *
 * Used by:
 *   - The /import/wizard "Step 2 — Categorías y marca" combobox, when the
 *     merchant types a brand name that isn't in the dropdown and confirms
 *     "+ Crear «name»".
 *   - Any future inline-create flow (single-product create, WC import).
 *
 * The lookup uses `ilike` so "Hills" and "hills" resolve to the same row.
 * On insert, the case-insensitive unique index uq_brand_instance_lower_name
 * (added 20260519000003) makes the operation safe under concurrent clicks:
 * the second caller's INSERT raises 23505 and we retry the lookup.
 */
export type CreateOrFindBrandResult =
  | { ok: true; brand: { brand_id: number; brand_name: string }; created: boolean }
  | { ok: false; error: string };

export async function createOrFindBrand(
  rawName: string,
): Promise<CreateOrFindBrandResult> {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "El nombre de la marca está vacío." };
  if (name.length > 120) {
    return { ok: false, error: "El nombre de la marca es demasiado largo." };
  }

  const instanceId = await currentInstanceId();
  if (instanceId === null) {
    return { ok: false, error: "Sin instancia activa." };
  }

  const supabase = await createClient();

  // 1. Case-insensitive lookup.
  const existing = await supabase
    .from("brand")
    .select("brand_id, brand_name")
    .eq("instance_id", instanceId)
    .ilike("brand_name", name)
    .limit(1)
    .maybeSingle();
  if (existing.data) {
    return {
      ok: true,
      brand: {
        brand_id: Number(existing.data.brand_id),
        brand_name: String(existing.data.brand_name),
      },
      created: false,
    };
  }

  // 2. Insert. RLS will enforce instance-membership; the case-insensitive
  // unique index catches concurrent insert races.
  const insert = await supabase
    .from("brand")
    .insert({ instance_id: instanceId, brand_name: name })
    .select("brand_id, brand_name")
    .single();

  if (insert.data) {
    return {
      ok: true,
      brand: {
        brand_id: Number(insert.data.brand_id),
        brand_name: String(insert.data.brand_name),
      },
      created: true,
    };
  }

  // 23505 = unique_violation. A concurrent caller already created it —
  // re-run the lookup and return that one.
  if (insert.error?.code === "23505") {
    const retry = await supabase
      .from("brand")
      .select("brand_id, brand_name")
      .eq("instance_id", instanceId)
      .ilike("brand_name", name)
      .limit(1)
      .maybeSingle();
    if (retry.data) {
      return {
        ok: true,
        brand: {
          brand_id: Number(retry.data.brand_id),
          brand_name: String(retry.data.brand_name),
        },
        created: false,
      };
    }
  }

  return {
    ok: false,
    error: insert.error?.message ?? "No se pudo crear la marca.",
  };
}
