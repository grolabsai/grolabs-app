import type { AxisDef } from "@/app/[locale]/(app)/catalog/products/_types";

type CategoryNode = {
  category_id: number;
  parent_category_id: number | null;
  category_name: string;
};

type AxisMapping = {
  category_id: number;
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string | null;
  dimension: string | null;
  variant_axis_order: number | null;
  options: { value_id: number; value: string }[];
};

/**
 * Resolves the effective variant axes for a product's primary category.
 *
 * Algorithm (per policy docs/policy/products-and-variants.md):
 * 1. Walk up from primaryCategoryId to root, building a leaf-first chain.
 * 2. Collect axis mappings per level, sorted by variant_axis_order.
 * 3. Dedupe by attribute_id — the shallowest (leaf-closest) occurrence wins.
 * 4. Result is sorted by (depth_from_leaf asc, variant_axis_order asc).
 */
export function getInheritedVariantAxes(
  primaryCategoryId: number,
  allCategories: CategoryNode[],
  axisMappings: AxisMapping[],
): AxisDef[] {
  const catById = new Map(allCategories.map((c) => [c.category_id, c]));

  // Build leaf-first chain (index 0 = leaf = primary category)
  const chain: CategoryNode[] = [];
  let cur = catById.get(primaryCategoryId);
  while (cur) {
    chain.push(cur);
    const parentId = cur.parent_category_id;
    cur = parentId != null ? catById.get(parentId) : undefined;
  }

  // Group axis mappings by category_id
  const byCategory = new Map<number, AxisMapping[]>();
  for (const m of axisMappings) {
    if (!byCategory.has(m.category_id)) byCategory.set(m.category_id, []);
    byCategory.get(m.category_id)!.push(m);
  }

  // Walk leaf → root, first occurrence of each attribute_id wins
  const seen = new Set<number>();
  const result: AxisDef[] = [];

  for (const cat of chain) {
    const mappings = (byCategory.get(cat.category_id) ?? []).slice().sort(
      (a, b) => (a.variant_axis_order ?? 0) - (b.variant_axis_order ?? 0),
    );
    for (const m of mappings) {
      if (seen.has(m.attribute_id)) continue;
      seen.add(m.attribute_id);
      result.push({
        attribute_id: m.attribute_id,
        attribute_code: m.attribute_code,
        attribute_name: m.attribute_name,
        data_type: m.data_type,
        dimension: m.dimension,
        variant_axis_order: m.variant_axis_order ?? 0,
        from_category_id: cat.category_id,
        from_category_name: cat.category_name,
        options: m.options,
      });
    }
  }

  return result;
}
