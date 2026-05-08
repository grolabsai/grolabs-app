/**
 * Typed client for GLPIM's Scout-facing /agents/* endpoints.
 *
 * Both functions are server-only (called from server actions). They read
 * the GLPIM URL from the GLPIM_API_URL env var and fail loudly if it's
 * not set — easier than discovering the misconfig at runtime per request.
 *
 * Contract is documented at: glpim/docs/integration.md
 */

const GLPIM_API_URL = process.env.GLPIM_API_URL;

function ensureBaseUrl(): string {
  if (!GLPIM_API_URL) {
    throw new Error(
      "GLPIM_API_URL is not set. Configure it in your environment so Scout can call the GLPIM agent service.",
    );
  }
  return GLPIM_API_URL.replace(/\/+$/, "");
}

// ─── Shared shapes that mirror GLPIM's Pydantic models ────────────────────

export type ProductIn = {
  product_ref: string;
  name: string;
  brand?: string | null;
  photo_url?: string | null;
};

// ─── /agents/analyze-categories ────────────────────────────────────────────

export type CategorySuggestion = {
  product_ref: string;
  product_name: string;
  category_id: number | string;
  category_name: string;
  category_slug?: string | null;
  confidence: number; // 0..1
  confidence_tier: "high" | "medium" | "low";
  reasoning: string;
};

export type AnalyzeCategoriesResponse = {
  suggestions: CategorySuggestion[];
  persisted: number;
  model_used: string;
};

export async function analyzeCategories(input: {
  products: ProductIn[];
  /** When set, GLPIM fetches active categories for that instance. */
  instanceId?: number;
  /** When set, used directly instead of a DB lookup. */
  candidates?: Array<{
    category_id: number | string;
    name: string;
    parent_id?: number | string | null;
    slug?: string | null;
    parsing_hint?: string | null;
  }>;
  parsingHint?: string;
}): Promise<AnalyzeCategoriesResponse> {
  const url = `${ensureBaseUrl()}/agents/analyze-categories`;
  const body: Record<string, unknown> = {
    products: input.products,
  };
  // GLPIM's validator requires *exactly one* of `candidates` or `instance_id`.
  // Caller-supplied candidates win; instance_id is only used when no inline
  // candidate set is provided (the agent then fetches them by instance).
  if (input.candidates !== undefined) {
    body.candidates = input.candidates;
  } else if (input.instanceId !== undefined) {
    body.instance_id = input.instanceId;
  }
  if (input.parsingHint) body.parsing_hint = input.parsingHint;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw await glpimError(res, "analyze-categories");
  return (await res.json()) as AnalyzeCategoriesResponse;
}

// ─── /agents/group-products ────────────────────────────────────────────────

export type AxisValue = {
  attribute_id: number | string;
  attribute_code: string;
  value_id?: number | string | null;
  value_text?: string | null;
  value_number?: number | null;
  unit_id?: number | string | null;
  unit_code?: string | null;
  /** Literal substring of the source name that triggered this value. */
  extracted_from?: string | null;
};

export type AttributeValue = {
  attribute_id: number | string;
  attribute_code: string;
  value_id?: number | string | null;
  value_text?: string | null;
  extracted_from?: string | null;
};

export type GroupedVariant = {
  source_refs: string[];
  label: string;
  axis_values: AxisValue[];
  attribute_values: AttributeValue[];
};

export type GroupedBase = {
  base_name: string;
  category_id: number | string | null;
  variants: GroupedVariant[];
  confidence: number;
  confidence_tier: "high" | "medium" | "low";
  reasoning: string;
};

export type GroupProductsResponse = {
  bases: GroupedBase[];
  persisted: number;
  model_used: string;
};

export type VocabularyAttributeIn = {
  attribute_id: number | string;
  code: string;
  name: string;
  data_type: "list" | "multiselect" | "text" | "number" | "quantity" | "boolean" | "url";
  dimension?: "mass" | "volume" | "count" | "length" | null;
  options?: Array<{ value_id: number | string; value: string }>;
  allowed_units?: Array<{
    unit_id: number | string;
    code: string;
    name: string;
    dimension: "mass" | "volume" | "count" | "length";
  }>;
  required?: boolean;
};

export type VocabularyIn = {
  scope_label: string;
  variant_axes?: VocabularyAttributeIn[];
  descriptive_attributes?: VocabularyAttributeIn[];
  parsing_hint?: string | null;
};

export async function groupProducts(input: {
  products: ProductIn[];
  /** Form A: server fetches Scout's vocabulary for this category. */
  instanceId?: number;
  categoryId?: number;
  /** Form B: caller supplies vocabulary inline (sandbox / tests). */
  vocabulary?: VocabularyIn;
}): Promise<GroupProductsResponse> {
  const url = `${ensureBaseUrl()}/agents/group-products`;
  const body: Record<string, unknown> = {
    products: input.products,
  };
  if (input.instanceId !== undefined) body.instance_id = input.instanceId;
  if (input.categoryId !== undefined) body.category_id = input.categoryId;
  if (input.vocabulary !== undefined) body.vocabulary = input.vocabulary;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw await glpimError(res, "group-products");
  return (await res.json()) as GroupProductsResponse;
}

// ─── Internals ─────────────────────────────────────────────────────────────

async function glpimError(res: Response, where: string): Promise<Error> {
  let detail = "";
  try {
    const j = await res.json();
    if (j && typeof j === "object" && "detail" in j) {
      const d = (j as { detail: unknown }).detail;
      if (typeof d === "string") {
        detail = d;
      } else if (Array.isArray(d)) {
        // FastAPI Pydantic 422 returns detail as Array<{ loc, msg, type, ... }>.
        // Stringifying directly gives "[object Object]" — extract messages instead.
        detail = d
          .map((e) =>
            e && typeof e === "object" && "msg" in e
              ? String((e as { msg: unknown }).msg)
              : JSON.stringify(e),
          )
          .join("; ");
      } else {
        detail = JSON.stringify(d);
      }
    } else {
      detail = JSON.stringify(j);
    }
  } catch {
    try {
      detail = await res.text();
    } catch {
      detail = "<no response body>";
    }
  }
  return new Error(`GLPIM ${where} failed (${res.status}): ${detail}`);
}
