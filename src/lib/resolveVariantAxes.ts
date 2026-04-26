/**
 * resolveVariantAxes
 *
 * Given a category, pre-fetched variant axis rows, and the full flat list of
 * categories, walk up the parent chain and collect every variant axis entry.
 *
 * The resolved set for any category = axes defined on its topmost
 * ancestor + axes from each intermediate level + its own axes.
 * Order: ancestors first (top→down), then own.
 *
 * Returns an array of { axis, fromCategoryId, fromCategoryName, level, ... }
 * so the UI can show where each axis was inherited from.
 */

export type VariantAxisRow = {
  category_id: number;
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  variant_axis_order: number | null;
};

export type ResolvedAxis = {
  axis: string; // attribute_code — kept for VariantAxisConfig compatibility
  fromCategoryId: number;
  fromCategoryName: string;
  level: number;
  attributeName: string;
  attributeId: number;
  variantAxisOrder: number | null;
};

type CategoryLike = {
  category_id: number;
  parent_category_id: number | null;
  category_name: string;
  level: number;
};

/**
 * Build the ancestry chain from a category up to the root.
 * Returns [root, ..., grandparent, parent, self].
 */
function getAncestryChain(
  categoryId: number,
  allCategories: CategoryLike[],
): CategoryLike[] {
  const byId = new Map(allCategories.map((c) => [c.category_id, c]));
  const chain: CategoryLike[] = [];
  let current = byId.get(categoryId);

  while (current) {
    chain.unshift(current); // prepend — root ends up first
    current = current.parent_category_id
      ? byId.get(current.parent_category_id)
      : undefined;
  }

  return chain;
}

/**
 * Resolve the full set of variant axes available to a category.
 * Walks root → self using pre-fetched axis rows. Deduplicates by
 * attribute code — if the same attribute appears at multiple levels,
 * the highest (earliest ancestor) definition wins.
 */
export function resolveVariantAxes(
  categoryId: number,
  allAxisRows: VariantAxisRow[],
  allCategories: CategoryLike[],
): ResolvedAxis[] {
  const chain = getAncestryChain(categoryId, allCategories);

  const rowsByCategory = new Map<number, VariantAxisRow[]>();
  for (const row of allAxisRows) {
    const arr = rowsByCategory.get(row.category_id) ?? [];
    arr.push(row);
    rowsByCategory.set(row.category_id, arr);
  }

  const seen = new Set<string>();
  const resolved: ResolvedAxis[] = [];

  for (const cat of chain) {
    const rows = (rowsByCategory.get(cat.category_id) ?? []).sort(
      (a, b) => (a.variant_axis_order ?? 999) - (b.variant_axis_order ?? 999),
    );
    for (const row of rows) {
      if (!seen.has(row.attribute_code)) {
        seen.add(row.attribute_code);
        resolved.push({
          axis: row.attribute_code,
          fromCategoryId: cat.category_id,
          fromCategoryName: cat.category_name,
          level: cat.level,
          attributeName: row.attribute_name,
          attributeId: row.attribute_id,
          variantAxisOrder: row.variant_axis_order,
        });
      }
    }
  }

  return resolved;
}

/**
 * Convenience: just the axis strings, no metadata.
 */
export function resolveVariantAxesFlat(
  categoryId: number,
  allAxisRows: VariantAxisRow[],
  allCategories: CategoryLike[],
): string[] {
  return resolveVariantAxes(categoryId, allAxisRows, allCategories).map((r) => r.axis);
}
