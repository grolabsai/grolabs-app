/**
 * resolveVariantAxes
 *
 * Given a category and the full flat list of categories, walk up the
 * parent chain and collect every `default_variant_axes` entry.
 *
 * The resolved set for any category = axes defined on its topmost
 * ancestor + axes from each intermediate level + its own axes.
 * Order: ancestors first (top→down), then own.
 *
 * Returns an array of { axis, fromCategoryId, fromCategoryName, level }
 * so the UI can show where each axis was inherited from.
 */

export type ResolvedAxis = {
  axis: string;
  fromCategoryId: number;
  fromCategoryName: string;
  level: number;
};

type CategoryLike = {
  category_id: number;
  parent_category_id: number | null;
  category_name: string;
  level: number;
  default_variant_axes: string[] | null;
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
 * Walks root → self, collecting axes at each level. Deduplicates
 * by axis name — if the same axis appears at multiple levels,
 * the highest (earliest ancestor) definition wins.
 */
export function resolveVariantAxes(
  categoryId: number,
  allCategories: CategoryLike[],
): ResolvedAxis[] {
  const chain = getAncestryChain(categoryId, allCategories);
  const seen = new Set<string>();
  const resolved: ResolvedAxis[] = [];

  for (const cat of chain) {
    const axes = cat.default_variant_axes ?? [];
    for (const axis of axes) {
      if (!seen.has(axis)) {
        seen.add(axis);
        resolved.push({
          axis,
          fromCategoryId: cat.category_id,
          fromCategoryName: cat.category_name,
          level: cat.level,
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
  allCategories: CategoryLike[],
): string[] {
  return resolveVariantAxes(categoryId, allCategories).map((r) => r.axis);
}
