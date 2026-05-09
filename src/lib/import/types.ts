/**
 * Types shared across the import wizard (Steps 1–6).
 *
 * Wizard state is held in a React Context at the route level
 * (`/import/wizard`) and passed step-by-step. Each step reads what it
 * needs and writes the next step's inputs.
 */

import type { CreateProductFullInput } from "@/lib/actions/product";

// ─── Step 1: Upload ────────────────────────────────────────────────────────

export type ParsedFile = {
  fileName: string;
  /** Header row (one entry per column) — derived from the first row when hasHeaders=true, else synthetic Column A/B/... */
  columns: string[];
  /** Body rows — does NOT include the header row. */
  rows: string[][];
  /** Whether the user said the first sheet row is a header. */
  hasHeaders: boolean;
};

// ─── Step 2: Brand & category assignment ───────────────────────────────────

export type BrandPick = {
  brandId: number | null;
};

export type ColumnPick = {
  /** Index into ParsedFile.columns */
  productNameColumn: number | null;
  productPhotoColumn: number | null;
  /** When true, the agent will be asked to extract variant axes from the name in Step 3. */
  llmExtraction: boolean;
};

export type CategoryAssignment = {
  rowIndex: number;
  productName: string;
  brand?: string;
  photoUrl?: string;
  /** What the agent suggested */
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  confidence: number; // 0..1
  confidenceTier: "high" | "medium" | "low";
  reasoning: string;
  /** What the user picked (defaults to the agent's suggestion until overridden). */
  categoryId: number | null;
  /** Display name for categoryId — kept in sync by the reducer. */
  categoryName: string | null;
  /** True once the user changes categoryId away from the suggestion. */
  userSelected: boolean;
};

// ─── Step 3: Product grouping ──────────────────────────────────────────────

export type ProposedAxisCell = {
  attributeId: number | string;
  attributeCode: string;
  attributeName: string;
  dataType: "list" | "quantity" | "text" | "number" | "boolean" | "url" | "multiselect";
  /** For list-typed axes; resolved to a known option when matched. */
  valueId: number | string | null;
  /** For text-typed axes, or list-typed when the value didn't match a known option. */
  valueText: string | null;
  /** For quantity-typed axes. */
  valueNumber: number | null;
  unitId: number | string | null;
  unitCode: string | null;
  /**
   * Literal substring of the source product name that produced this value
   * (as the agent reported it). Used by Step 3's source-name highlighter
   * to color the exact span the agent pulled from. May differ in casing
   * or wording from `valueText` (e.g. source "Adult" → option "Adulto").
   * Null when the value was inferred from context with no quotable trigger.
   */
  extractedFrom: string | null;
};

export type ProposedAttributeCell = {
  attributeId: number | string;
  attributeCode: string;
  attributeName: string;
  dataType: string;
  valueId: number | string | null;
  valueText: string | null;
  /** See ProposedAxisCell.extractedFrom. */
  extractedFrom: string | null;
};

export type ProposedVariantRow = {
  /** Stable client-side id for keying. */
  id: string;
  /** Source rows in the uploaded file that produced this variant (usually 1). */
  sourceRowIndices: number[];
  axes: ProposedAxisCell[];
  attributes: ProposedAttributeCell[];
  /** Agent-derived display label, user-editable. */
  label: string;
  // Editable fields — populated by Step 4 column mapping (or left blank if unmapped).
  sku: string;
  barcode: string;
  weightGrams: string;
  listPrice: string;
  costPrice: string;
  stockQty: string;
};

export type ProposedProductBaseRow = {
  /** Stable client-side id for keying. */
  id: string;
  baseName: string;
  /** From Step 2; not editable inside Step 3. */
  categoryId: number | null;
  categoryName: string | null;
  /** Per the agent's self-assessment. */
  confidence: number; // 0..1
  reasoning: string;
  /**
   * Descriptive attribute values that apply to EVERY variant of this base
   * (e.g. medicado=true on a prescription line, target_life_stage=Adult on
   * an adult-only product). Written once into product_attribute_value at
   * import. A variant can override a base attr by carrying the same
   * attribute_id in its own `attributes`; that override goes to
   * product_variant_attribute and trumps the base value at read time.
   */
  baseAttributes: ProposedAttributeCell[];
  variants: ProposedVariantRow[];
};

// ─── Step 4: Column mapping ────────────────────────────────────────────────

/**
 * Where does each Scout product/variant field get its value from?
 *
 *   { columnIndex: number } — copy from this column of the uploaded file
 *   "extract"               — leave to the agent (only valid for fields the
 *                              agent extracts: variant axis values etc.)
 *   "unmapped"              — skip this field (default; produces blanks)
 */
export type ScoutFieldId =
  | "slug"
  | "shortDescription"
  | "longDescription"
  | "sku"
  | "barcode"
  | "weightGrams"
  | "listPrice"
  | "costPrice"
  | "stockQty";

export type ColumnMapping = Record<
  ScoutFieldId,
  { kind: "column"; columnIndex: number } | { kind: "extract" } | { kind: "unmapped" }
>;

// ─── Step 6: Result ────────────────────────────────────────────────────────

export type ImportResult = {
  /** Number of distinct base products successfully created. */
  basesCreated: number;
  /** Total variants created across all base products. */
  variantsCreated: number;
  /** Per-base error messages, if any. */
  errors: Array<{ baseName: string; error: string }>;
};

// ─── Agent panel ───────────────────────────────────────────────────────────

/**
 * One entry in the right-side agent log. The wizard's agent calls (and
 * hand-rolled status updates) drop these in chronologically; the panel
 * renders them as a running narrative.
 *
 * Today this is one-way (system → user). The shape is intentionally chat-
 * like so that a future iteration can add user-side messages without a
 * data-model migration.
 */
export type AgentMessage = {
  /** Stable client-side id for keying. */
  id: string;
  /** ms since epoch (UTC). Display formatted client-side. */
  timestamp: number;
  /** Visual + semantic role. Drives icon and color. */
  kind: "info" | "thinking" | "success" | "warning" | "error";
  /** One-line headline (e.g. "Analyze categories"). */
  title: string;
  /** Free-form prose body — what the agent did or what went wrong. */
  body: string;
  /**
   * Optional structured payload for the user to inspect or copy. The panel
   * shows a "Copy" button when this is set; the value is JSON-stringified.
   */
  raw?: unknown;
};

// ─── Wizard state aggregate ────────────────────────────────────────────────

export type WizardState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;

  // Step 1
  parsedFile: ParsedFile | null;

  // Step 2
  brand: BrandPick;
  columns: ColumnPick;
  /**
   * Categories the user picks as the search scope before running analysis.
   * The agent's candidate set is the union of these picks and all of their
   * descendants. When that union resolves to a single category the agent
   * is skipped and every row is assigned to it directly.
   */
  candidateCategoryIds: number[];
  categoryAssignments: CategoryAssignment[];
  /** True while Step 2's "Analizar con IA" call is in flight. */
  analyzingCategories: boolean;
  categoriesAnalyzed: boolean;

  // Step 3
  productBases: ProposedProductBaseRow[];
  /** True while Step 3's "Agrupar con IA" call is in flight. */
  grouping: boolean;
  grouped: boolean;

  // Step 4
  columnMapping: ColumnMapping;

  // Step 6
  importing: boolean;
  importResult: ImportResult | null;
};

// ─── Submission shape (what Step 6 sends to createProductsBulk) ────────────

export type BulkCreateInput = {
  brandId: number | null;
  bases: Array<{
    categoryId: number;
    payload: CreateProductFullInput;
  }>;
};
