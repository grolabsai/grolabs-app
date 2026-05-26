/**
 * Resolve the *effective* attribute set for an import-wizard category.
 *
 * Per CLAUDE.md §10, parent categories cascade their attribute and axis
 * definitions to children, with leaf-closest definitions winning on
 * duplicate `attribute_id`. The DB only stores explicitly-defined rows;
 * this helper does the resolution at read time so Step 3 can render
 * one column per attribute (axis or descriptive) regardless of which
 * level in the tree defined it.
 *
 * The ASE adapter does the same thing on the server side (so the
 * agent sees the right vocabulary for extraction). This is the GroLabs
 * counterpart, used purely for rendering the editor in Step 3.
 */

import type {
  Attribute,
  Category,
  CategoryAttributeLink,
} from "@/components/import/ImportWizard";

export type EffectiveAttribute = Attribute & {
  isVariantAxis: boolean;
  variantAxisOrder: number | null;
  formOrder: number | null;
  required: boolean;
};

export type EffectiveVocabulary = {
  axes: EffectiveAttribute[];
  descriptive: EffectiveAttribute[];
};

export function effectiveVocabularyFor(
  categoryId: number,
  categories: Category[],
  links: CategoryAttributeLink[],
  attributes: Attribute[],
): EffectiveVocabulary {
  const catById = new Map<number, Category>();
  for (const c of categories) catById.set(c.category_id, c);

  // Walk leaf → root via parent_category_id, then reverse so the loop
  // below applies root rows first and leaf rows last (leaf wins).
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | null = categoryId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = catById.get(current)?.parent_category_id ?? null;
  }
  chain.reverse();

  const linkByAttr = new Map<number, CategoryAttributeLink>();
  for (const cId of chain) {
    for (const r of links) {
      if (r.category_id === cId) linkByAttr.set(r.attribute_id, r);
    }
  }

  const attrById = new Map<number, Attribute>();
  for (const a of attributes) attrById.set(a.attribute_id, a);

  const axes: EffectiveAttribute[] = [];
  const descriptive: EffectiveAttribute[] = [];
  for (const link of linkByAttr.values()) {
    const attr = attrById.get(link.attribute_id);
    if (!attr) continue;
    const eff: EffectiveAttribute = {
      ...attr,
      isVariantAxis: link.is_variant_axis,
      variantAxisOrder: link.variant_axis_order,
      formOrder: link.form_order,
      required: link.requirement_level === "required",
    };
    if (link.is_variant_axis) axes.push(eff);
    else descriptive.push(eff);
  }
  axes.sort(
    (a, b) =>
      (a.variantAxisOrder ?? 9999) - (b.variantAxisOrder ?? 9999) ||
      a.attribute_id - b.attribute_id,
  );
  descriptive.sort(
    (a, b) =>
      (a.formOrder ?? 9999) - (b.formOrder ?? 9999) ||
      a.attribute_id - b.attribute_id,
  );
  return { axes, descriptive };
}
