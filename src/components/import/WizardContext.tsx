"use client";

import { createContext, useContext, useReducer, type ReactNode } from "react";

import type {
  CategoryAssignment,
  ColumnMapping,
  ColumnPick,
  ImportResult,
  ParsedFile,
  ProposedAttributeCell,
  ProposedAxisCell,
  ProposedProductBaseRow,
  ScoutFieldId,
  WizardState,
} from "@/lib/import/types";

// ─── Initial state ─────────────────────────────────────────────────────────

const DEFAULT_MAPPING: ColumnMapping = {
  slug: { kind: "unmapped" },
  shortDescription: { kind: "unmapped" },
  longDescription: { kind: "unmapped" },
  sku: { kind: "unmapped" },
  barcode: { kind: "unmapped" },
  weightGrams: { kind: "unmapped" },
  listPrice: { kind: "unmapped" },
  costPrice: { kind: "unmapped" },
  stockQty: { kind: "unmapped" },
};

const INITIAL: WizardState = {
  step: 1,
  parsedFile: null,
  brand: { brandId: null },
  columns: { productNameColumn: null, productPhotoColumn: null, llmExtraction: true },
  candidateCategoryIds: [],
  categoryAssignments: [],
  analyzingCategories: false,
  categoriesAnalyzed: false,
  productBases: [],
  grouping: false,
  grouped: false,
  columnMapping: DEFAULT_MAPPING,
  importing: false,
  importResult: null,
};

// ─── Actions ───────────────────────────────────────────────────────────────

type Action =
  | { type: "GO_TO_STEP"; step: WizardState["step"] }
  | { type: "SET_PARSED_FILE"; file: ParsedFile | null }
  | { type: "SET_BRAND"; brandId: number | null }
  | { type: "SET_COLUMNS"; cols: Partial<ColumnPick> }
  | { type: "SET_CANDIDATE_CATEGORIES"; ids: number[] }
  | { type: "SET_ANALYZING_CATEGORIES"; on: boolean }
  | { type: "SET_CATEGORY_ASSIGNMENTS"; assignments: CategoryAssignment[] }
  | { type: "UPDATE_CATEGORY_ASSIGNMENT"; rowIndex: number; categoryId: number | null; categoryName: string | null }
  | { type: "SET_GROUPING"; on: boolean }
  | { type: "SET_PRODUCT_BASES"; bases: ProposedProductBaseRow[] }
  | { type: "APPEND_PRODUCT_BASES"; bases: ProposedProductBaseRow[] }
  | { type: "UPDATE_VARIANT_FIELD"; baseId: string; variantId: string; field: keyof Pick<import("@/lib/import/types").ProposedVariantRow, "label" | "sku" | "barcode" | "weightGrams" | "listPrice" | "costPrice" | "stockQty">; value: string }
  | { type: "UPSERT_VARIANT_AXIS"; baseId: string; variantId: string; cell: ProposedAxisCell }
  | { type: "REMOVE_VARIANT_AXIS"; baseId: string; variantId: string; attributeId: number | string }
  | { type: "UPSERT_VARIANT_ATTRIBUTE"; baseId: string; variantId: string; cell: ProposedAttributeCell }
  | { type: "REMOVE_VARIANT_ATTRIBUTE"; baseId: string; variantId: string; attributeId: number | string }
  | { type: "UPSERT_BASE_ATTRIBUTE"; baseId: string; cell: ProposedAttributeCell }
  | { type: "REMOVE_BASE_ATTRIBUTE"; baseId: string; attributeId: number | string }
  | { type: "SET_COLUMN_MAPPING_FIELD"; field: ScoutFieldId; mapping: ColumnMapping[ScoutFieldId] }
  | { type: "SET_IMPORTING"; on: boolean }
  | { type: "SET_IMPORT_RESULT"; result: ImportResult | null };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "GO_TO_STEP":
      return { ...state, step: action.step };
    case "SET_PARSED_FILE":
      return {
        ...state,
        parsedFile: action.file,
        categoryAssignments: [],
        categoriesAnalyzed: false,
        productBases: [],
        grouped: false,
      };
    case "SET_BRAND":
      return { ...state, brand: { brandId: action.brandId } };
    case "SET_COLUMNS":
      return { ...state, columns: { ...state.columns, ...action.cols }, categoriesAnalyzed: false, productBases: [], grouped: false };
    case "SET_CANDIDATE_CATEGORIES":
      return {
        ...state,
        candidateCategoryIds: action.ids,
        categoryAssignments: [],
        categoriesAnalyzed: false,
        productBases: [],
        grouped: false,
      };
    case "SET_ANALYZING_CATEGORIES":
      return { ...state, analyzingCategories: action.on };
    case "SET_CATEGORY_ASSIGNMENTS":
      return { ...state, categoryAssignments: action.assignments, categoriesAnalyzed: true };
    case "UPDATE_CATEGORY_ASSIGNMENT":
      return {
        ...state,
        categoryAssignments: state.categoryAssignments.map((c) =>
          c.rowIndex === action.rowIndex
            ? {
                ...c,
                categoryId: action.categoryId,
                categoryName: action.categoryName ?? c.categoryName,
                userSelected:
                  action.categoryId !== c.suggestedCategoryId,
              }
            : c,
        ),
      };
    case "SET_GROUPING":
      return { ...state, grouping: action.on };
    case "SET_PRODUCT_BASES":
      return { ...state, productBases: action.bases, grouped: true };
    case "APPEND_PRODUCT_BASES":
      return {
        ...state,
        productBases: [...state.productBases, ...action.bases],
        grouped: true,
      };
    case "UPDATE_VARIANT_FIELD":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                variants: b.variants.map((v) =>
                  v.id === action.variantId ? { ...v, [action.field]: action.value } : v,
                ),
              }
            : b,
        ),
      };
    case "UPSERT_VARIANT_AXIS":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                variants: b.variants.map((v) => {
                  if (v.id !== action.variantId) return v;
                  const exists = v.axes.some((a) => a.attributeId === action.cell.attributeId);
                  return {
                    ...v,
                    axes: exists
                      ? v.axes.map((a) =>
                          a.attributeId === action.cell.attributeId ? action.cell : a,
                        )
                      : [...v.axes, action.cell],
                  };
                }),
              }
            : b,
        ),
      };
    case "REMOVE_VARIANT_AXIS":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                variants: b.variants.map((v) =>
                  v.id === action.variantId
                    ? { ...v, axes: v.axes.filter((a) => a.attributeId !== action.attributeId) }
                    : v,
                ),
              }
            : b,
        ),
      };
    case "UPSERT_VARIANT_ATTRIBUTE":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                variants: b.variants.map((v) => {
                  if (v.id !== action.variantId) return v;
                  const exists = v.attributes.some(
                    (a) => a.attributeId === action.cell.attributeId,
                  );
                  return {
                    ...v,
                    attributes: exists
                      ? v.attributes.map((a) =>
                          a.attributeId === action.cell.attributeId ? action.cell : a,
                        )
                      : [...v.attributes, action.cell],
                  };
                }),
              }
            : b,
        ),
      };
    case "REMOVE_VARIANT_ATTRIBUTE":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                variants: b.variants.map((v) =>
                  v.id === action.variantId
                    ? {
                        ...v,
                        attributes: v.attributes.filter(
                          (a) => a.attributeId !== action.attributeId,
                        ),
                      }
                    : v,
                ),
              }
            : b,
        ),
      };
    case "UPSERT_BASE_ATTRIBUTE":
      return {
        ...state,
        productBases: state.productBases.map((b) => {
          if (b.id !== action.baseId) return b;
          const exists = b.baseAttributes.some(
            (a) => a.attributeId === action.cell.attributeId,
          );
          return {
            ...b,
            baseAttributes: exists
              ? b.baseAttributes.map((a) =>
                  a.attributeId === action.cell.attributeId ? action.cell : a,
                )
              : [...b.baseAttributes, action.cell],
          };
        }),
      };
    case "REMOVE_BASE_ATTRIBUTE":
      return {
        ...state,
        productBases: state.productBases.map((b) =>
          b.id === action.baseId
            ? {
                ...b,
                baseAttributes: b.baseAttributes.filter(
                  (a) => a.attributeId !== action.attributeId,
                ),
              }
            : b,
        ),
      };
    case "SET_COLUMN_MAPPING_FIELD":
      return { ...state, columnMapping: { ...state.columnMapping, [action.field]: action.mapping } };
    case "SET_IMPORTING":
      return { ...state, importing: action.on };
    case "SET_IMPORT_RESULT":
      return { ...state, importResult: action.result };
    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────

type Ctx = {
  state: WizardState;
  dispatch: (a: Action) => void;
};

const WizardCtx = createContext<Ctx | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  return <WizardCtx.Provider value={{ state, dispatch }}>{children}</WizardCtx.Provider>;
}

export function useWizard(): Ctx {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard must be used inside WizardProvider");
  return ctx;
}
