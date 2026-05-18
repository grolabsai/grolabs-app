"use server";

import { revalidatePath } from "next/cache";

import {
  createProductFull,
  type CreateProductFullInput,
} from "@/lib/actions/product";
import { currentInstanceId } from "@/lib/instance";
import { withActivity } from "@/lib/activity/server";
import type { WithActivity } from "@/lib/activity/event";
import {
  analyzeCategories as glpimAnalyzeCategories,
  groupProducts as glpimGroupProducts,
  type AnalyzeCategoriesResponse,
  type GroupProductsResponse,
  type ProductIn,
} from "@/lib/glpim";

// ─── Wizard → GLPIM bridges ────────────────────────────────────────────────

/**
 * Step 2 of the wizard: get the agent's category suggestion per product.
 *
 * Wraps GLPIM's /agents/analyze-categories. Two shapes:
 *  - omit `candidates` and the agent picks from every active category for
 *    the user's instance (GLPIM does the DB lookup).
 *  - pass `candidates` and the agent only chooses from that exact set —
 *    used by the wizard to scope the search to the descendants of a
 *    parent category the user picked.
 */
export async function analyzeImportCategories(input: {
  products: ProductIn[];
  candidates?: Array<{
    category_id: number;
    name: string;
    parent_id?: number | null;
    slug?: string | null;
    parsing_hint?: string | null;
  }>;
  parsingHint?: string;
}): Promise<
  WithActivity<{ ok: true; data: AnalyzeCategoriesResponse } | { error: string }>
> {
  return withActivity(async () => {
    const instanceId = await currentInstanceId();
    if (instanceId === null) return { error: "No instance" };
    try {
      const data = await glpimAnalyzeCategories({
        products: input.products,
        instanceId,
        candidates: input.candidates,
        parsingHint: input.parsingHint,
      });
      return { ok: true as const, data };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Step 3 of the wizard: ask the agent to group rows into base products
 * with extracted variant axes + descriptive attributes for the chosen
 * category. GLPIM builds the vocabulary from GroLabs's tables.
 */
export async function groupImportProducts(input: {
  products: ProductIn[];
  categoryId: number;
}): Promise<
  WithActivity<{ ok: true; data: GroupProductsResponse } | { error: string }>
> {
  return withActivity(async () => {
    const instanceId = await currentInstanceId();
    if (instanceId === null) return { error: "No instance" };
    try {
      const data = await glpimGroupProducts({
        products: input.products,
        instanceId,
        categoryId: input.categoryId,
      });
      return { ok: true as const, data };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Bulk-create products from the import wizard.
 *
 * The wizard produces N CreateProductFullInput payloads (one per detected
 * base product). We loop and call the existing createProductFull for each
 * — that action already handles atomic per-product create with rollback,
 * RLS scoping, and revalidation. No need to duplicate that logic.
 *
 * If a product fails, we record the error and continue with the rest.
 * The caller surfaces failures in the Step-6 result UI.
 *
 * Note on transactions: there's no all-or-nothing across products; each
 * product is its own transaction inside createProductFull. A partial
 * failure leaves some products created and others not. The wizard's
 * Step-6 UI surfaces this so the user can decide whether to re-run the
 * failed ones manually.
 */
export type BulkImportResult = {
  basesCreated: number;
  variantsCreated: number;
  errors: Array<{ baseName: string; error: string }>;
  /** product_ids of every successfully created base, in the order received. */
  createdProductIds: number[];
};

export async function createProductsBulk(
  inputs: CreateProductFullInput[],
): Promise<BulkImportResult> {
  const result: BulkImportResult = {
    basesCreated: 0,
    variantsCreated: 0,
    errors: [],
    createdProductIds: [],
  };

  for (const input of inputs) {
    const r = await createProductFull(input);
    if ("error" in r) {
      result.errors.push({ baseName: input.name, error: r.error ?? "Unknown error" });
      continue;
    }
    result.basesCreated += 1;
    result.variantsCreated += input.variants.length;
    result.createdProductIds.push(r.productId);
  }

  revalidatePath("/catalog/products", "page");
  return result;
}
