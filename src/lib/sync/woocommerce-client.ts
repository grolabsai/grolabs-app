/**
 * Tiny WooCommerce REST client. Just the operations Scout needs:
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
  const url = `${client.siteUrl.replace(/\/+$/, "")}/wp-json/wc/v3${path}`;
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

// ─── Categories ────────────────────────────────────────────────────────────

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
