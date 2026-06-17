/**
 * Stitch landed staging rows back into canonical product objects (P4).
 *
 * Two input shapes converge here (see docs/design/bulk-intake.md):
 *   - Whole product objects (SDK/API sends ProductObject[] with no part_role) →
 *     pass through unchanged.
 *   - A multi-table dump (parts tagged products / variants / attributes …) →
 *     join children onto their parent product by a link field.
 *
 * v1 best-effort: reassembles products + variants + product-linked attribute
 * values via link keys (from the session's data_dictionary, with sensible
 * defaults). Other parts (e.g. a standalone category catalog) are collected and
 * reported as `unlinked` — their richer resolution is interpretation's job (P5),
 * not a mechanical join.
 */

export type StagingRow = { raw_data: Record<string, unknown>; part_role: string | null };

/** Per-part hints from import_job.data_dictionary. */
export type PartSpec = { key?: string; links_to?: string };
export type DataDictionary = Record<string, PartSpec> | null | undefined;

export type StitchResult = {
  products: Record<string, unknown>[];
  /** Parts (or rows) we could not attach to a product, for transparency. */
  unlinked: { part_role: string; count: number }[];
};

function keyStr(v: unknown): string | null {
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function stitchProductObjects(
  rows: StagingRow[],
  dictionary?: DataDictionary,
): StitchResult {
  const dict: Record<string, PartSpec> = dictionary ?? {};

  const byRole = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const role = r.part_role ?? "_unlabeled";
    const arr = byRole.get(role) ?? [];
    arr.push(r.raw_data);
    byRole.set(role, arr);
  }

  // Products come from an explicit 'products' part, else the unlabeled stream
  // (whole product objects sent directly).
  const productsFromLabeled = byRole.has("products");
  const productRaws = byRole.get("products") ?? byRole.get("_unlabeled") ?? [];
  const productKeyField = dict.products?.key ?? "id";

  const products: Record<string, unknown>[] = [];
  const index = new Map<string, Record<string, unknown>>();
  for (const raw of productRaws) {
    const product: Record<string, unknown> = { ...raw };
    const k = keyStr(raw[productKeyField]);
    if (product.id === undefined && raw[productKeyField] !== undefined) {
      product.id = raw[productKeyField];
    }
    products.push(product);
    if (k !== null) index.set(k, product);
  }

  const unlinked: { part_role: string; count: number }[] = [];

  // Attach a child part onto its parent product by a link field.
  function attach(role: string, target: "variants" | "attributes", defaultLink: string) {
    const raws = byRole.get(role);
    if (!raws) return;
    const linkField = dict[role]?.links_to ?? defaultLink;
    let missed = 0;
    for (const raw of raws) {
      const parentKey = keyStr(raw[linkField]);
      const parent = parentKey !== null ? index.get(parentKey) : undefined;
      if (!parent) {
        missed++;
        continue;
      }
      const child: Record<string, unknown> = { ...raw };
      delete child[linkField];
      const list = (parent[target] as Record<string, unknown>[] | undefined) ?? [];
      list.push(child);
      parent[target] = list;
    }
    if (missed > 0) unlinked.push({ part_role: role, count: missed });
  }

  attach("variants", "variants", "product_id");
  attach("attributes", "attributes", "product_id");
  attach("attribute_values", "attributes", "product_id");

  // Report parts we collected but did not mechanically reassemble.
  const handled = new Set([
    "products",
    "_unlabeled",
    "variants",
    "attributes",
    "attribute_values",
  ]);
  // If products came from the labeled part, surface stray unlabeled rows too.
  if (productsFromLabeled) handled.delete("_unlabeled");
  for (const [role, raws] of byRole) {
    if (handled.has(role)) continue;
    unlinked.push({ part_role: role, count: raws.length });
  }

  return { products, unlinked };
}
