/**
 * Tiny WooCommerce REST client. Just the operations GroLabs needs:
 *   - GET /products?sku=...                (lookup by SKU)
 *   - POST /products                        (create parent product)
 *   - PUT /products/{id}                    (update parent product)
 *   - POST /products/{id}/variations/batch  (variants in bulk)
 *   - GET  /                                (smoke-test for the verify step)
 *
 * Auth: HTTPS Basic with consumer_key:consumer_secret. WooCommerce's REST
 * API also supports query-string auth but Basic is simpler and not
 * weaker as long as the connection is HTTPS (the API rejects HTTP).
 *
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
 */

const REQUEST_TIMEOUT_MS = 30_000;

export type WooClient = {
  /** Fully-qualified site URL, no trailing slash. */
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type WooHttpResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function authHeader(c: WooClient): string {
  const token = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function request<T>(
  client: WooClient,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<WooHttpResult<T>> {
  return requestAt<T>(client, "wc/v3", method, path, body);
}

/** Same as request() but lets the caller hit a different REST namespace —
 *  e.g. "wp/v2" for the WordPress core endpoints (taxonomies, post types)
 *  that the field-mapping detection probes use. Auth and timeout behaviour
 *  is identical: Basic auth with the same WC consumer key+secret, which
 *  WP accepts for /wp/v2/ endpoints when Basic Auth is enabled (or when
 *  the user is also a WP admin; in practice every WC consumer key has
 *  enough WP-side capability for read access to taxonomies). */
async function requestAt<T>(
  client: WooClient,
  namespace: "wc/v3" | "wp/v2",
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<WooHttpResult<T>> {
  const url = `${client.siteUrl.replace(/\/+$/, "")}/wp-json/${namespace}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(client),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const status = res.status;
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      return { ok: false, status, error: `WC ${method} ${path} → ${status}: ${detail.slice(0, 500)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ─── Verify ────────────────────────────────────────────────────────────────

export type VerifyResult = { ok: boolean; status: number; latencyMs: number; message?: string };

/**
 * Probe `GET /wp-json/wc/v3` — returns metadata about the API on success.
 * Used by the Configuration screen "Test connection" button.
 */
export async function verifyWooConnection(client: WooClient): Promise<VerifyResult> {
  const start = Date.now();
  const r = await request<unknown>(client, "GET", "");
  return {
    ok: r.ok,
    status: r.status,
    latencyMs: Date.now() - start,
    message: r.ok ? undefined : "error" in r ? r.error : undefined,
  };
}

// ─── Products ──────────────────────────────────────────────────────────────

export type WooProduct = {
  id: number;
  sku: string;
  name: string;
  slug?: string;
  type?: string;
};

export type ProductPayload = {
  name: string;
  type: "simple" | "variable";
  status?: "publish" | "draft" | "private";
  sku?: string;
  description?: string;
  short_description?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
  manage_stock?: boolean;
  stock_status?: "instock" | "outofstock" | "onbackorder";
  weight?: string;
  categories?: Array<{ id?: number; name?: string }>;
  images?: Array<{ src: string; alt?: string }>;
  attributes?: Array<{
    name: string;
    visible?: boolean;
    variation?: boolean;
    options: string[];
  }>;
  meta_data?: Array<{ key: string; value: string | number | boolean }>;
};

export type VariationPayload = {
  sku?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
  manage_stock?: boolean;
  stock_status?: "instock" | "outofstock" | "onbackorder";
  weight?: string;
  image?: { src: string; alt?: string };
  attributes: Array<{ name: string; option: string }>;
  meta_data?: Array<{ key: string; value: string | number | boolean }>;
};

/**
 * Look up a product by SKU. Returns the first match (WC requires SKUs
 * to be unique across products). Returns null when no match.
 */
export async function findProductBySku(
  client: WooClient,
  sku: string,
): Promise<{ ok: true; product: WooProduct | null } | { ok: false; error: string; status: number }> {
  const r = await request<WooProduct[]>(client, "GET", `/products?sku=${encodeURIComponent(sku)}&per_page=1`);
  if (!r.ok) return { ok: false, error: r.error, status: r.status };
  return { ok: true, product: r.data[0] ?? null };
}

export async function createProduct(
  client: WooClient,
  payload: ProductPayload,
): Promise<WooHttpResult<WooProduct>> {
  return request<WooProduct>(client, "POST", "/products", payload);
}

export async function updateProduct(
  client: WooClient,
  id: number,
  payload: Partial<ProductPayload>,
): Promise<WooHttpResult<WooProduct>> {
  return request<WooProduct>(client, "PUT", `/products/${id}`, payload);
}

// ─── Variations (batch) ────────────────────────────────────────────────────

export type VariationBatchPayload = {
  create?: VariationPayload[];
  update?: Array<VariationPayload & { id: number }>;
  delete?: number[];
};

export type WooVariation = { id: number; sku: string };

export type VariationBatchResult = {
  create: WooVariation[];
  update: WooVariation[];
  delete: Array<{ id: number }>;
};

export async function batchVariations(
  client: WooClient,
  productId: number,
  payload: VariationBatchPayload,
): Promise<WooHttpResult<VariationBatchResult>> {
  return request<VariationBatchResult>(
    client,
    "POST",
    `/products/${productId}/variations/batch`,
    payload,
  );
}

// ─── Categories (push direction — used by the WC sync) ────────────────────

export type WooCategory = {
  id: number;
  name: string;
  slug: string;
  parent: number;
};

export type CategoryPayload = {
  name: string;
  slug?: string;
  parent?: number;
  description?: string;
};

export async function listCategories(
  client: WooClient,
  params: { slug?: string; perPage?: number } = {},
): Promise<WooHttpResult<WooCategory[]>> {
  const qs = new URLSearchParams();
  if (params.slug) qs.set("slug", params.slug);
  qs.set("per_page", String(params.perPage ?? 100));
  const path = `/products/categories?${qs.toString()}`;
  return request<WooCategory[]>(client, "GET", path);
}

export async function createCategory(
  client: WooClient,
  payload: CategoryPayload,
): Promise<WooHttpResult<WooCategory>> {
  return request<WooCategory>(client, "POST", "/products/categories", payload);
}

// ─── Listing (pull direction — used by the WC import: docs/policy/wc-import.md)
//
// Returned shapes are intentionally permissive — the import path preserves
// every unmapped field in product.wc_raw, so we keep it as a Record and let
// the mapper extract what it needs.

export type WooCategoryRaw = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description?: string;
  [key: string]: unknown;
};

export type WooProductRaw = {
  id: number;
  name: string;
  slug?: string;
  sku?: string;
  status?: string;
  type?: string;
  description?: string;
  short_description?: string;
  regular_price?: string;
  sale_price?: string;
  price?: string;
  stock_quantity?: number | null;
  /** WC 8.3+ native GTIN field. */
  global_unique_id?: string;
  categories?: Array<{ id: number; name?: string; slug?: string }>;
  images?: Array<{ src: string; alt?: string }>;
  meta_data?: Array<{ key: string; value: unknown }>;
  variations?: number[];
  attributes?: unknown[];
  tags?: Array<{ id: number; name?: string; slug?: string }>;
  [key: string]: unknown;
};

/**
 * Subset of WC store settings the import cares about: the weight unit
 * controls how variation.weight is converted to grams, and the currency
 * defaults product_pricing.currency for imported variants.
 *
 * Endpoint: GET /wp-json/wc/v3/settings/products/{id} where {id} is the
 * setting key. We probe two: woocommerce_weight_unit and woocommerce_currency.
 * Both have a string `value` field in the WC settings shape.
 */
export type WooStoreSettings = {
  weightUnit: "g" | "kg" | "oz" | "lb" | null;
  currency: string | null;
};

export async function getStoreSettings(
  client: WooClient,
): Promise<WooHttpResult<WooStoreSettings>> {
  type SettingRow = { id?: string; value?: string };

  const [w, c] = await Promise.all([
    request<SettingRow>(
      client,
      "GET",
      "/settings/products/woocommerce_weight_unit",
    ),
    request<SettingRow>(
      client,
      "GET",
      "/settings/general/woocommerce_currency",
    ),
  ]);

  // Both settings calls can independently fail on tightly-locked WC
  // installs; treat as soft failures and let the caller fall back to
  // defaults. Hard-fail only when BOTH error (likely auth or wrong URL).
  if (!w.ok && !c.ok) {
    return { ok: false, status: w.status || c.status, error: w.ok ? c.error : w.error };
  }

  const rawWeight = w.ok ? (w.data.value ?? "").toString().toLowerCase() : "";
  const weightUnit =
    rawWeight === "g" || rawWeight === "kg" || rawWeight === "oz" || rawWeight === "lb"
      ? (rawWeight as "g" | "kg" | "oz" | "lb")
      : null;

  const currency = c.ok ? (c.data.value ?? "").toString().toUpperCase().trim() || null : null;

  return { ok: true, status: 200, data: { weightUnit, currency } };
}

export async function listProductCategoriesPage(
  client: WooClient,
  page: number,
  perPage = 100,
): Promise<WooHttpResult<WooCategoryRaw[]>> {
  return request<WooCategoryRaw[]>(
    client,
    "GET",
    `/products/categories?per_page=${perPage}&page=${page}&orderby=id&order=asc`,
  );
}

export async function listProductsPage(
  client: WooClient,
  page: number,
  perPage = 100,
  status: "publish" | "any" = "publish",
): Promise<WooHttpResult<WooProductRaw[]>> {
  return request<WooProductRaw[]>(
    client,
    "GET",
    `/products?per_page=${perPage}&page=${page}&status=${status}&orderby=id&order=asc`,
  );
}

/** A WC variation as returned by GET /products/{id}/variations. Permissive
 * like WooProductRaw — the import preserves the full object on
 * product.wc_raw.variations and the mapper extracts only what it needs. */
export type WooVariationRaw = {
  id: number;
  sku?: string;
  status?: string;
  description?: string;
  regular_price?: string;
  sale_price?: string;
  price?: string;
  stock_quantity?: number | null;
  stock_status?: string;
  weight?: string;
  /** WC 8.3+ native GTIN field (same as on the parent). */
  global_unique_id?: string;
  image?: { src?: string; alt?: string } | null;
  attributes?: Array<{ id?: number; name?: string; slug?: string; option?: string }>;
  meta_data?: Array<{ key: string; value: unknown }>;
  [key: string]: unknown;
};

// ─── Detection helpers (used by the WC config page's "Detect" button) ───

/** WC core Brands feature (and most brand plugins) registers a
 *  /products/brands endpoint. A 200 here means at least one brand-aware
 *  REST endpoint is reachable on this site; 404 means none is installed. */
export type WooBrandTerm = {
  id: number;
  name: string;
  slug?: string;
  count?: number;
  [key: string]: unknown;
};

export async function getStoreBrands(
  client: WooClient,
): Promise<WooHttpResult<WooBrandTerm[]>> {
  return request<WooBrandTerm[]>(client, "GET", "/products/brands?per_page=20");
}

/** Returns the WP-side taxonomy registry. Used to detect plugin-provided
 *  taxonomies like `pwb-brand`, `yith_product_brand`, `product_brands` that
 *  aren't exposed via the WC namespace. The shape is an object keyed by
 *  taxonomy slug; we keep it permissive. */
export type WpTaxonomyEntry = {
  name?: string;
  slug?: string;
  rest_base?: string;
  rest_namespace?: string;
  types?: string[];
  [key: string]: unknown;
};

export async function getWpTaxonomies(
  client: WooClient,
): Promise<WooHttpResult<Record<string, WpTaxonomyEntry>>> {
  return requestAt<Record<string, WpTaxonomyEntry>>(
    client,
    "wp/v2",
    "GET",
    "/taxonomies",
  );
}

export async function listProductVariationsPage(
  client: WooClient,
  productId: number,
  page: number,
  perPage = 100,
): Promise<WooHttpResult<WooVariationRaw[]>> {
  return request<WooVariationRaw[]>(
    client,
    "GET",
    `/products/${productId}/variations?per_page=${perPage}&page=${page}&orderby=id&order=asc`,
  );
}
