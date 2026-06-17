import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Promote ACCEPTED proposals into the live catalog (the one production write).
 *
 * Reads accepted `variant_structure` suggestions for a session and creates
 * `product` (+ `product_variant`) rows, resolving `brand` through the existing
 * case-insensitive unique index (so nike/Nike/NIKE collapse to one brand — we
 * reuse that dedup rather than reimplement it).
 *
 * Idempotent: a promoted suggestion gets its `entity_id` set to the new
 * product_id, and only accepted suggestions WITHOUT an entity_id are promoted —
 * so re-running never duplicates. Writes via the service-role client with
 * explicit instance_id.
 */

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

type SuggestionRow = {
  suggestion_id: number;
  payload: Record<string, unknown>;
  entity_id: number | null;
};

export type PromoteResult = {
  promoted: number;
  skipped: number;
  product_ids: number[];
};

type LibError = { ok: false; error: string };

async function resolveBrandId(
  sb: SupabaseClient,
  instanceId: number,
  brandMap: Map<string, number>,
  rawName: string,
): Promise<number | null> {
  const name = rawName.trim();
  const key = name.toLowerCase();
  if (key === "") return null;
  const existing = brandMap.get(key);
  if (existing !== undefined) return existing;

  const { data, error } = await sb
    .from("brand")
    .insert({ instance_id: instanceId, brand_name: name })
    .select("brand_id")
    .single();
  if (error) {
    // unique-index collision (case-insensitive) — re-read and use the existing row
    const { data: rows } = await sb
      .from("brand")
      .select("brand_id, brand_name")
      .eq("instance_id", instanceId);
    const found = ((rows ?? []) as { brand_id: number; brand_name: string }[]).find(
      (b) => b.brand_name.trim().toLowerCase() === key,
    );
    if (found) {
      brandMap.set(key, found.brand_id);
      return found.brand_id;
    }
    return null;
  }
  const id = (data as { brand_id: number }).brand_id;
  brandMap.set(key, id);
  return id;
}

export async function promoteAccepted(
  sb: SupabaseClient,
  instanceId: number,
  jobId: number,
): Promise<{ ok: true; result: PromoteResult } | LibError> {
  const { data: sugs, error } = await sb
    .from("catalog_suggestion")
    .select("suggestion_id, payload, entity_id")
    .eq("instance_id", instanceId)
    .eq("job_id", jobId)
    .eq("suggestion_type", "variant_structure")
    .eq("status", "accepted")
    .order("suggestion_id");
  if (error) return { ok: false, error: error.message };

  const all = (sugs ?? []) as SuggestionRow[];
  const toPromote = all.filter((s) => s.entity_id == null);

  // preload existing brands for case-insensitive dedup
  const { data: brands } = await sb
    .from("brand")
    .select("brand_id, brand_name")
    .eq("instance_id", instanceId);
  const brandMap = new Map<string, number>();
  for (const b of (brands ?? []) as { brand_id: number; brand_name: string }[]) {
    brandMap.set(b.brand_name.trim().toLowerCase(), b.brand_id);
  }

  const productIds: number[] = [];
  for (const s of toPromote) {
    const p = s.payload;
    const title =
      typeof p.title === "string" && p.title.length > 0
        ? p.title
        : p.id != null
          ? String(p.id)
          : "Untitled";
    const brandId =
      typeof p.brand === "string" ? await resolveBrandId(sb, instanceId, brandMap, p.brand) : null;

    const { data: prod, error: prodErr } = await sb
      .from("product")
      .insert({
        instance_id: instanceId,
        product_name: title,
        slug: `${slugify(title)}-${s.suggestion_id}`,
        brand_id: brandId,
        price: typeof p.price === "number" ? p.price : null,
        sku: p.id != null ? String(p.id) : null,
        image_url: typeof p.image === "string" ? p.image : null,
        short_description: typeof p.description === "string" ? p.description : null,
        is_consignment: false,
        track_inventory: false,
        is_active: true,
        wc_raw: {},
      })
      .select("product_id")
      .single();
    if (prodErr) return { ok: false, error: `product insert failed: ${prodErr.message}` };

    const productId = (prod as { product_id: number }).product_id;
    productIds.push(productId);

    const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : [];
    if (variants.length > 0) {
      const vrows = variants.map((v) => {
        const axisValues = Object.entries(v)
          .filter(([k]) => k !== "id" && k !== "attributes")
          .map(([, val]) => val)
          .filter((val) => typeof val === "string" || typeof val === "number")
          .map(String);
        return {
          instance_id: instanceId,
          product_id: productId,
          sku: v.id != null ? String(v.id) : null,
          variant_label: axisValues.length > 0 ? axisValues.join(" / ") : null,
          is_active: true,
          is_pack: false,
        };
      });
      const { error: vErr } = await sb.from("product_variant").insert(vrows);
      if (vErr) return { ok: false, error: `variant insert failed: ${vErr.message}` };
    }

    await sb
      .from("catalog_suggestion")
      .update({ entity_type: "product", entity_id: productId })
      .eq("instance_id", instanceId)
      .eq("suggestion_id", s.suggestion_id);
  }

  return {
    ok: true,
    result: {
      promoted: productIds.length,
      skipped: all.length - toPromote.length,
      product_ids: productIds,
    },
  };
}
