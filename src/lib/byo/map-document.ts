/**
 * Map an arbitrary merchant document into the GroLabs canonical structure for
 * Meilisearch, retaining the original payload for display.
 *
 * Known-fields mapper: recognizes a small canonical set (aligned with
 * DEFAULT_INDEX_SETTINGS so search/filter/facet work out of the box) and keeps
 * the entire original document as the `display` payload that search returns
 * verbatim. A per-merchant field-mapping config is deferred (Open decision 4).
 *
 * Plan: docs/design/byo-integration-meilisearch-parity.md (P2).
 */

export type IngestDocument = Record<string, unknown>;

export type MappedDocument = {
  /** The merchant's primary key, as text — byo_document.document_id. */
  documentId: string;
  /** Mapped canonical fields — byo_document.canonical. */
  canonical: Record<string, unknown>;
  /** The merchant's original payload — byo_document.display + returned on search. */
  display: IngestDocument;
  /** The Meilisearch document: original payload at top level (so search returns
   *  the merchant's own fields), canonical normalization layered on top, plus
   *  the instance_id tenant filter. */
  search: Record<string, unknown>;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/**
 * Returns the mapped document, or `null` when the document has no usable
 * primary key (cannot be indexed — counted as a rejection by the caller).
 */
export function mapDocument(
  doc: IngestDocument,
  instanceId: number,
  primaryKey = "id",
): MappedDocument | null {
  const rawId = doc[primaryKey];
  const documentId = rawId == null ? "" : String(rawId);
  if (!documentId) return null;

  const canonical: Record<string, unknown> = { id: documentId };

  const name = str(doc.name) ?? str(doc.title);
  if (name !== undefined) canonical.name = name;

  const description = str(doc.description);
  if (description !== undefined) canonical.description = description;

  const brand = str(doc.brand);
  if (brand !== undefined) canonical.brand = brand;

  if (Array.isArray(doc.categories)) canonical.categories = doc.categories;
  if (Array.isArray(doc.category_ids)) canonical.category_ids = doc.category_ids;

  const price = num(doc.price);
  if (price !== undefined) canonical.price = price;

  const inStock = bool(doc.in_stock);
  if (inStock !== undefined) canonical.in_stock = inStock;

  const image =
    str(doc.image_url) ??
    str(doc.image) ??
    str(doc.thumbnail_url) ??
    str(doc.thumbnail);
  if (image !== undefined) canonical.image_url = image;

  const url = str(doc.url);
  if (url !== undefined) canonical.url = url;

  // Variants pass through as-is when present (nested searchable per the index
  // defaults); the mapper does not reshape them in v1.
  if (Array.isArray(doc.variants)) canonical.variants = doc.variants;

  canonical.popularity = num(doc.popularity) ?? 0;

  const search: Record<string, unknown> = {
    // The merchant's original payload at top level, so search returns the
    // fields they sent (governed by attributesToRetrieve in P5)...
    ...doc,
    // ...with canonical normalization layered on top (stable string `id`,
    // normalized name/price/etc. for search/rank/facets)...
    ...canonical,
    // ...and the defense-in-depth tenant filter matching the `instance_id = N`
    // rule baked into every tenant token (search-foundations.md §6).
    instance_id: instanceId,
  };

  return { documentId, canonical, display: doc, search };
}
